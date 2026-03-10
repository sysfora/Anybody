'use client';

import { Mail, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '@/components/theme-toggle';

export default function RegistrationSuccessful() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
            <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle className="text-2xl font-bold">Registration successful!</CardTitle>
          <CardDescription>
            Your account has been created successfully
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span>Check your email for verification</span>
            </div>
            <p className="text-sm text-muted-foreground">
              We&apos;ve sent a verification link to your email address. Please check your inbox and click the link to verify your account.
            </p>
          </div>

          <div className="bg-muted p-4 rounded-lg">
            <h4 className="font-medium text-sm mb-2">What&apos;s next?</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Check your email inbox (and spam folder)</li>
              <li>• Click the verification link</li>
              <li>• Login to your account</li>
              <li>• Start using the platform</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
