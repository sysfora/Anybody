"use client";

import { useEffect, Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Check, Loader2, Sparkles, Zap, Infinity, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import pb from "@/lib/pocketbase";
import { useAuthRedirect } from "@/hooks/use-auth-redirect";
import { SUBSCRIPTION_RESUME_KEY, type SubscriptionResumeData } from "@/components/SubscriptionPopup";

function SubscriptionSuccessContent() {
  useAuthRedirect();
  
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get("session_id");
  const [countdown, setCountdown] = useState(5);
  const [isUpdating, setIsUpdating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumeData, setResumeData] = useState<SubscriptionResumeData | null>(null);

  // Read the resume data saved before the user went to Stripe.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SUBSCRIPTION_RESUME_KEY);
      if (raw) setResumeData(JSON.parse(raw) as SubscriptionResumeData);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // If no session_id in URL, try to get it from recent sessions
    const fetchSessionId = async () => {
      if (!sessionId) {
        // Check if we're coming from a successful checkout
        const success = searchParams.get("success");
        if (success === "true") {
          // Try to get the latest session for this user
          try {
            const userId = pb.authStore.model?.id;
            if (userId) {
              const response = await fetch("/api/subscription/get-latest-session", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ userId }),
              });

              if (response.ok) {
                const data = await response.json();
                if (data.sessionId) {
                  // Use the retrieved session ID
                  updateSubscriptionWithSession(data.sessionId);
                  return;
                }
              }
            }
          } catch (error) {
            console.error("Error fetching latest session:", error);
          }
          
          // If we can't get session, proceed with webhook fallback
          console.warn("No session_id available, webhook will handle the update");
          setIsUpdating(false);
          return;
        }
        router.push("/subscription");
        return;
      }
      
      // If we have sessionId, proceed with update
      updateSubscriptionWithSession(sessionId);
    };

    const updateSubscriptionWithSession = async (sessionIdToUse: string) => {
      try {
        setIsUpdating(true);
        const userId = pb.authStore.model?.id;
        
        if (!userId) {
          console.error("User not logged in");
          setIsUpdating(false);
          return;
        }

        // Call API to update subscription from Stripe session
        const response = await fetch("/api/subscription/update-from-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId: sessionIdToUse,
            userId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error || response.statusText;
          console.error("Failed to update subscription:", errorMessage);
          setError(errorMessage);
          // Don't block the user - webhook will handle it
        } else {
          setError(null);
        }
      } catch (error) {
        console.error("Error updating subscription:", error);
        setError("Failed to update subscription. Webhook will handle it.");
      } finally {
        setIsUpdating(false);
      }
    };

    fetchSessionId();
  }, [sessionId, router, searchParams]);

  // Countdown timer — redirect to the original page when done.
  useEffect(() => {
    if (!isUpdating && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (!isUpdating && countdown === 0) {
      // resumeData stays in localStorage so the target page can restore the prompt.
      router.push(resumeData?.returnTo ?? "/subscription");
    }
  }, [countdown, isUpdating, router, resumeData]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-2xl">
        <Card className="border-border rounded-2xl overflow-hidden">
          {/* Header Section */}
          <div className="bg-primary/5 border-b border-border p-8 text-center">
            {isUpdating ? (
              <div className="flex flex-col items-center justify-center gap-4">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10">
                  <Loader2 className="w-10 h-10 text-primary animate-spin" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold mb-2">Activating Your Subscription</h1>
                  <p className="text-muted-foreground">Please wait while we set everything up...</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10">
                  <Check className="w-10 h-10 text-primary" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold mb-2">Welcome to Pro!</h1>
                  <p className="text-muted-foreground text-lg">
                    Your subscription has been successfully activated
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Content Section */}
          <div className="p-8">
            {!isUpdating && (
              <>
                <div className="mb-8">
                  <p className="text-center text-muted-foreground mb-6">
                    You now have access to all Pro features and benefits
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card">
                      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Zap className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold mb-1">1000 Credits</h3>
                        <p className="text-sm text-muted-foreground">Per month included</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card">
                      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold mb-1">250k Context</h3>
                        <p className="text-sm text-muted-foreground">Extended window size</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card">
                      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Infinity className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold mb-1">Unlimited Projects</h3>
                        <p className="text-sm text-muted-foreground">Create as many as you need</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card">
                      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Users className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold mb-1">Team Collaboration</h3>
                        <p className="text-sm text-muted-foreground">Work together seamlessly</p>
                      </div>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="mb-6 p-4 rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-950 dark:border-orange-900">
                    <p className="text-sm text-orange-700 dark:text-orange-300">
                      <strong>Note:</strong> {error}. The webhook will update your subscription shortly.
                    </p>
                  </div>
                )}

                <div className="space-y-4">
                  <Button
                    onClick={() => router.push(resumeData?.returnTo ?? "/subscription")}
                    className="w-full rounded-xl h-12 text-base font-medium"
                    size="lg"
                  >
                    {resumeData?.returnTo ? "Continue Building" : "View Subscription"}
                  </Button>
                  {resumeData?.pendingPrompt && (
                    <p className="text-center text-xs text-muted-foreground px-4">
                      Your prompt <span className="font-medium text-foreground">&ldquo;{resumeData.pendingPrompt.slice(0, 60)}{resumeData.pendingPrompt.length > 60 ? '…' : ''}&rdquo;</span> will be waiting for you.
                    </p>
                  )}
                  <p className="text-center text-sm text-muted-foreground">
                    Redirecting automatically in {countdown} second{countdown !== 1 ? 's' : ''}...
                  </p>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function SubscriptionSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="w-full max-w-2xl">
          <Card className="border-border rounded-2xl overflow-hidden">
            <div className="p-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <p className="text-muted-foreground">Loading...</p>
            </div>
          </Card>
        </div>
      </div>
    }>
      <SubscriptionSuccessContent />
    </Suspense>
  );
}

