'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import pb from '@/lib/pocketbase';
import { ThemeToggle } from '@/components/theme-toggle';
import { Spinner } from '@/components/spinner';
import { TeamService } from '@/lib/team';
import { isTemporaryEmail } from '@/lib/email-validation';

function LoginContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFromInvite, setIsFromInvite] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Check for pending invitation and auto-fill email
  useEffect(() => {
    const loadInvitationEmail = async () => {
      const invitationEmail = await TeamService.getPendingInvitationEmail();
      if (invitationEmail) {
        setEmail(invitationEmail);
        setIsFromInvite(true);
      }
    };
    loadInvitationEmail();
  }, []);

  useEffect(() => {
    const handleGoogleCallback = async () => {
      try {
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const codeVerifier = localStorage.getItem('codeVerifier');

        if (code && state && codeVerifier) {
          setIsLoading(true);

          const authData = await pb.collection('users').authWithOAuth2Code(
            'google',
            code,
            codeVerifier,
            `${window.location.origin}/login`
          );

          localStorage.removeItem('codeVerifier');

          if (authData) {
            // Generate username for Google OAuth user if they don't have one
            if (!authData.record.username) {
              try {
                const usernameResponse = await fetch('/api/user/generate-username', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ fullName: authData.record.name }),
                });

                if (usernameResponse.ok) {
                  const { username } = await usernameResponse.json();
                  
                  // Update user with generated username via API route
                  await fetch('/api/user/update-username', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                      userId: authData.record.id, 
                      username 
                    }),
                  });
                }
              } catch (error) {
                console.error('Failed to generate username for Google user:', error);
              }
            }

            toast.success('Successfully registered with Google!');
            const processed = await TeamService.processPendingInvitation();
            // Store auth data as JSON string in cookie
            const cookieAuthData = {
              token: pb.authStore.token,
              model: pb.authStore.model
            };
            cookieStore.set({
              name: 'pocketbase_auth',
              value: JSON.stringify(cookieAuthData),
              expires: new Date('2099-12-31').getTime(), // Set expiration to year 2099 (effectively never expires)
              path: '/'
            });
            router.push(processed ? '/team' : '/');
          }
        }
        } catch (error: unknown) {
        console.error('Google OAuth callback error:', error);
        toast.error('Failed to complete Google authentication. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    handleGoogleCallback();
  }, [searchParams, router, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    if (isTemporaryEmail(email)) {
      toast.error('Temporary or disposable email addresses are not allowed. Please use a valid email address.');
      setIsLoading(false);
      return;
    }

    try {
      const authData = await pb.collection('users').authWithPassword(email, password);
      
      if (authData) {
        toast.success('Successfully logged in!');
        const processed = await TeamService.processPendingInvitation();
        // Store auth data as JSON string in cookie
        const cookieAuthData = {
          token: pb.authStore.token,
          model: pb.authStore.model
        };
        cookieStore.set({
          name: 'pocketbase_auth',
          value: JSON.stringify(cookieAuthData),
          expires: new Date('2099-12-31').getTime(), // Set expiration to year 2099 (effectively never expires)
          path: '/'
        });
        if (processed) {
          toast.success('Team invitation accepted!');
          router.push('/team');
        } else {
          router.push('/');
        }
      }
    } catch (error: unknown) {
      console.error('Login error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to log in. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setIsLoading(true);
    try {
      // Check if PocketBase URL is configured
      if (!process.env.NEXT_PUBLIC_POCKETBASE_URL) {
        toast.error('PocketBase is not configured. Please set NEXT_PUBLIC_POCKETBASE_URL in your environment variables.');
        setIsLoading(false);
        return;
      }

      const authMethods = await pb.collection('users').listAuthMethods();
      const googleProvider = authMethods.oauth2?.providers?.find((provider: { name: string }) => provider.name === 'google');

      if (!googleProvider) {
        toast.error('Google OAuth provider not configured');
        setIsLoading(false);
        return;
      }

      const codeVerifier = googleProvider.codeVerifier;
      localStorage.setItem('codeVerifier', codeVerifier);

      const redirectUrl = `${window.location.origin}/login`;
      const authUrl = `${googleProvider.authURL}${encodeURIComponent(redirectUrl)}`;

      window.location.href = authUrl;
    } catch (error: unknown) {
      console.error('Google auth error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to redirect to Google. Please try again.';
      
      // Check if it's a 404 error (PocketBase not running or wrong URL)
      if (errorMessage.includes('404') || errorMessage.includes('Failed to fetch')) {
        toast.error('Cannot connect to PocketBase. Please ensure PocketBase is running and NEXT_PUBLIC_POCKETBASE_URL is set correctly.');
      } else {
        toast.error(errorMessage);
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
          <CardDescription>
            Login to your account to continue
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  disabled={isFromInvite}
                />
              </div>
              {isFromInvite && (
                <p className="text-xs text-muted-foreground">
                  Email pre-filled from team invitation
                </p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Link
                href="/forgot-password"
                className="text-sm text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Logging in...
                </>
              ) : (
                'Login'
              )}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleGoogleAuth}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Connecting...
              </>
            ) : (
              <>
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </>
            )}
          </Button>

          <div className="text-center text-sm">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-primary hover:underline">
              Register
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </CardContent>
        </Card>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}