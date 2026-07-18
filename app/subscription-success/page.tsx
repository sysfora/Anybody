"use client";

import { useEffect, Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import pb from "@/lib/pocketbase";
import { useAuthRedirect } from "@/hooks/use-auth-redirect";
import {
  SUBSCRIPTION_RESUME_KEY,
  type SubscriptionResumeData,
} from "@/components/SubscriptionPopup";

function readResumeData(): SubscriptionResumeData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SUBSCRIPTION_RESUME_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SubscriptionResumeData;
  } catch {
    return null;
  }
}

function resolveContinuePath(resume: SubscriptionResumeData | null): string {
  const returnTo = resume?.returnTo?.trim();
  if (returnTo) return returnTo;
  return "/";
}

function SubscriptionSuccessContent() {
  useAuthRedirect();

  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get("session_id");

  const [resumeData] = useState<SubscriptionResumeData | null>(() =>
    readResumeData()
  );
  const continuePath = resolveContinuePath(resumeData);
  const hasPendingPrompt = Boolean(resumeData?.pendingPrompt?.trim());

  const [countdown, setCountdown] = useState(3);
  const [isUpdating, setIsUpdating] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const updateSubscriptionWithSession = async (sessionIdToUse: string) => {
      try {
        setIsUpdating(true);
        const userId = pb.authStore.model?.id;

        if (!userId) {
          setIsUpdating(false);
          return;
        }

        const response = await fetch("/api/subscription/update-from-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionIdToUse,
            userId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          setError(
            errorData.error ||
              "Could not confirm payment yet. Your plan will update shortly."
          );
        } else {
          setError(null);
        }
      } catch {
        setError(
          "Could not confirm payment yet. Your plan will update shortly."
        );
      } finally {
        setIsUpdating(false);
      }
    };

    const fetchSessionId = async () => {
      if (!sessionId) {
        const success = searchParams.get("success");
        if (success === "true") {
          try {
            const userId = pb.authStore.model?.id;
            if (userId) {
              const response = await fetch(
                "/api/subscription/get-latest-session",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId }),
                }
              );

              if (response.ok) {
                const data = await response.json();
                if (data.sessionId) {
                  await updateSubscriptionWithSession(data.sessionId);
                  return;
                }
              }
            }
          } catch (err) {
            console.error("Error fetching latest session:", err);
          }

          setIsUpdating(false);
          return;
        }
        router.push("/subscription");
        return;
      }

      await updateSubscriptionWithSession(sessionId);
    };

    void fetchSessionId();
  }, [sessionId, router, searchParams]);

  useEffect(() => {
    if (isUpdating) return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }

    // Keep resume data in localStorage so the destination can restore the prompt.
    router.push(continuePath);
  }, [countdown, isUpdating, router, continuePath]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md text-center space-y-6">
        {isUpdating ? (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight">
                Activating your plan
              </h1>
              <p className="text-muted-foreground text-sm">
                Just a moment…
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
              <Check className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">
                Congratulations!
              </h1>
              <p className="text-muted-foreground">
                Your Pro subscription is active.
                {hasPendingPrompt
                  ? " Taking you back so you can continue with your prompt."
                  : " Taking you back to the dashboard."}
              </p>
            </div>

            {error ? (
              <p className="text-sm text-muted-foreground">{error}</p>
            ) : null}

            <div className="space-y-3 pt-2">
              <Button
                onClick={() => router.push(continuePath)}
                className="w-full rounded-xl h-11"
                size="lg"
              >
                {hasPendingPrompt ? "Continue with your prompt" : "Go to dashboard"}
              </Button>
              <p className="text-sm text-muted-foreground">
                Redirecting in {countdown}s…
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function SubscriptionSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <SubscriptionSuccessContent />
    </Suspense>
  );
}
