'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, Eye, EyeOff, User, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import pb from '@/lib/pocketbase';
import { ThemeToggle } from '@/components/theme-toggle';
import { Spinner } from '@/components/spinner';
import { TeamService } from '@/lib/team';
import { isTemporaryEmail } from '@/lib/email-validation';

function RegisterContent() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFromInvite, setIsFromInvite] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

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

  // Handle Google OAuth callback
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
            `${window.location.origin}/register`
          );

          localStorage.removeItem('codeVerifier');

          if (authData) {
            // Generate username for Google OAuth user
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

            toast({
              title: 'Success',
              description: 'Successfully registered with Google!',
            });
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
        toast({
          title: 'Error',
          description: 'Failed to complete Google authentication. Please try again.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    handleGoogleCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    if (password !== confirmPassword) {
      toast({
        title: 'Error',
        description: 'Passwords do not match',
        variant: 'destructive',
      });
      setIsLoading(false);
      return;
    }

    if (password.length < 8) {
      toast({
        title: 'Error',
        description: 'Password must be at least 8 characters long',
        variant: 'destructive',
      });
      setIsLoading(false);
      return;
    }

    if (!agreeToTerms) {
      toast({
        title: 'Error',
        description: 'Please agree to the terms and conditions',
        variant: 'destructive',
      });
      setIsLoading(false);
      return;
    }

    if (isTemporaryEmail(email)) {
      toast({
        title: 'Error',
        description: 'Temporary or disposable email addresses are not allowed. Please use a valid email address.',
        variant: 'destructive',
      });
      setIsLoading(false);
      return;
    }

    try {
      // Generate username based on full name
      const usernameResponse = await fetch('/api/user/generate-username', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fullName: name }),
      });

      if (!usernameResponse.ok) {
        throw new Error('Failed to generate username');
      }

      const { username } = await usernameResponse.json();

      const data = {
        name,
        username,
        email,
        password,
        passwordConfirm: confirmPassword,
        credits: 50,
      };

      await pb.collection('users').create(data);
      
      if (!isFromInvite) {
        await pb.collection('users').requestVerification(email);
      }
      
      await pb.collection('users').authWithPassword(email, password);
      
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
        toast({
          title: 'Success',
          description: 'Account registered and team invitation accepted!',
        });
        router.push('/team');
      } else {
        toast({
          title: 'Success',
          description: 'Account registered successfully! Please check your email to verify your account.',
        });
        router.push('/registration-succesful');
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Email already in use',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setIsLoading(true);
    try {
      const authMethods = await pb.collection('users').listAuthMethods();
      const googleProvider = authMethods.oauth2.providers.find((provider: { name: string }) => provider.name === 'google');

      if (!googleProvider) {
        return { success: false, error: 'Google OAuth provider not configured' };
      }

      const codeVerifier = googleProvider.codeVerifier;
      localStorage.setItem('codeVerifier', codeVerifier);


      const redirectUrl = `${window.location.origin}/register`;
      const authUrl = `${googleProvider.authURL}${encodeURIComponent(redirectUrl)}`;

      window.location.href = authUrl;
    } catch (error: unknown) {
      console.error('Google auth error:', error);
      toast({
        title: 'Error',
        description: 'Failed to redirect to Google. Please try again.',
        variant: 'destructive',
      });
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
          <CardTitle className="text-2xl font-bold">Register Account</CardTitle>
          <CardDescription>
            Register to get started with your account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="name"
                  type="text"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

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

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10 pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="terms"
                checked={agreeToTerms}
                onCheckedChange={(checked) => setAgreeToTerms(checked as boolean)}
              />
              <Label htmlFor="terms" className="text-sm">
                I agree to the{' '}
                <Link href="/terms" className="text-primary hover:underline">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className="text-primary hover:underline">
                  Privacy Policy
                </Link>
              </Label>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Registering...
                </>
              ) : (
                'Register'
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
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Register() {
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
      <RegisterContent />
    </Suspense>
  );
}
