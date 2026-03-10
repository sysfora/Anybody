"use client";

import { useState, useEffect } from "react";
import { Check, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import pb from "@/lib/pocketbase";
import { useRouter } from "next/navigation";
import { STRIPE_PRICES } from "@/lib/stripe";
import { Sidebar } from "@/components/Dashboard/Sidebar";
import { NavigationBar } from "@/components/NavigationBar";

const freePlanFeatures = [
  "50 credits",
  "No downloads",
  "Projects expire in 7 days",
  "Model trained on your project",
  "Personal use",
  "Public projects",
];

const proPlanFeatures = [
  "1000 credits per month",
  "250k context window",
  "Pay-as-you-go for additional credits",
  "Unlimited projects",
  "Unlimited downloads",
  "Projects never expire",
  "No model training on your project",
  "Commercial use",
  "Private projects",
  "Team collaboration",
];

interface SubscriptionStatus {
  hasActiveSubscription: boolean;
  plan: 'free' | 'pro';
  billingCycle: 'monthly' | 'yearly' | null;
  status: string | null;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}

interface PocketBaseUser {
  id: string;
  email?: string;
  plan?: string;
  stripe_id?: string;
  [key: string]: unknown;
}

export default function SubscriptionPage() {
  const router = useRouter();
  const [user, setUser] = useState<PocketBaseUser | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [selectedBillingCycle, setSelectedBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [pendingBillingCycle, setPendingBillingCycle] = useState<"monthly" | "yearly" | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userId = pb.authStore.model?.id;
        if (!userId) {
          router.push("/login");
          return;
        }

        // Fetch user data
        const userData = await pb.collection("users").getOne(userId);
        setUser(userData);

        // Fetch Stripe subscription status
        const statusResponse = await fetch("/api/subscription/status", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId }),
        });

        if (statusResponse.ok) {
          const status = await statusResponse.json();
          setSubscriptionStatus(status);
          
          // Set billing cycle from Stripe if available, otherwise default to monthly
          if (status.billingCycle) {
            setBillingCycle(status.billingCycle);
            setSelectedBillingCycle(status.billingCycle);
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        toast.error("Failed to load subscription information");
      } finally {
        setLoading(false);
      }
    };

    if (pb.authStore.isValid) {
      fetchData();
    } else {
      router.push("/login");
    }
  }, [router]);

  const handleCancel = async () => {
    try {
      setPortalLoading(true);
      const userId = pb.authStore.model?.id;

      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId }),
      });

      const { url, error } = await response.json();

      if (error) {
        throw new Error(error);
      }

      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error(error);
      toast.error("Something went wrong. Please try again.");
      setPortalLoading(false);
    }
  };

  const handleBillingCycleChange = (newCycle: "monthly" | "yearly") => {
    // Always update the selected billing cycle to reflect the tab change
    // Don't show warning on tab switch - only show when button is clicked
    setSelectedBillingCycle(newCycle);
    
    if (!isPro) {
      setBillingCycle(newCycle);
    }
  };

  const handleConfirmBillingCycleChange = async () => {
    if (!pendingBillingCycle) return;

    try {
      setUpgradeLoading(true);
      setShowWarningDialog(false);
      
      const userId = pb.authStore.model?.id;
      const userEmail = pb.authStore.record?.email;

      // Create a new checkout session for the new billing cycle
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          priceId: STRIPE_PRICES[pendingBillingCycle],
          email: userEmail,
          userId: userId,
        }),
      });

      const { url, error } = await response.json();

      if (error) {
        throw new Error(error);
      }

      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error(error);
      toast.error("Something went wrong. Please try again.");
      setUpgradeLoading(false);
    }
  };

  const handleBillingCycleUpgrade = async () => {
    if (!isPro) return;

    const targetCycle = selectedBillingCycle;
    if (targetCycle === currentBillingCycle) {
      // If already on this cycle, just open portal
      await handleCancel();
      return;
    }

    // Show warning and proceed with upgrade/downgrade
    setPendingBillingCycle(targetCycle);
    setShowWarningDialog(true);
  };

  const handleUpgrade = async () => {
    try {
      if (isPro) {
        // If on Pro, redirect to portal to downgrade
        await handleCancel();
      } else {
        // If on Free, go directly to checkout with selected billing cycle
        setUpgradeLoading(true);
        const userId = pb.authStore.model?.id;
        const userEmail = pb.authStore.record?.email;

        const response = await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            priceId: STRIPE_PRICES[billingCycle],
            email: userEmail,
            userId: userId,
          }),
        });

        const { url, error } = await response.json();

        if (error) {
          throw new Error(error);
        }

        if (url) {
          window.location.href = url;
        }
      }
    } catch (error) {
      console.error(error);
      toast.error("Something went wrong. Please try again.");
      setUpgradeLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <NavigationBar variant="sidebar" />
        <Sidebar />
        <main className="ml-16 pt-16">
          <div className="h-[calc(100vh-4rem)] overflow-auto flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </main>
      </div>
    );
  }

  // Use Stripe subscription status if available, otherwise fall back to PocketBase plan
  const isPro = subscriptionStatus?.hasActiveSubscription || subscriptionStatus?.plan === "pro" || user?.plan === "pro" || user?.plan === "Pro";
  const currentBillingCycle = subscriptionStatus?.billingCycle || billingCycle;
  const displayBillingCycle = isPro ? selectedBillingCycle : billingCycle;
  const proPrice = displayBillingCycle === "yearly" ? 200 : 20;
  const proPeriod = displayBillingCycle === "yearly" ? "year" : "month";
  const needsBillingCycleChange = isPro && selectedBillingCycle !== currentBillingCycle;

  return (
    <div className="min-h-screen">
      <NavigationBar variant="sidebar" />
      <Sidebar />
      <main className="ml-16 pt-16">
        <div className="h-[calc(100vh-4rem)] overflow-auto">
          <div className="flex items-center justify-center p-4 bg-background pb-16 md:pb-32">
            <div className="w-full max-w-5xl px-6">
        <div className="mx-auto max-w-2xl space-y-6 text-center mb-12 md:mb-24 pt-8 md:pt-12">
          <h1 className="text-center text-4xl font-semibold lg:text-5xl">Pricing that Scales with You</h1>
          <p className="text-muted-foreground">
            Manage your subscription and billing
          </p>
        </div>

        <div className="flex justify-center mb-8">
          <Tabs
            value={displayBillingCycle}
            onValueChange={(value) => handleBillingCycleChange(value as "monthly" | "yearly")}
            className="inline-flex"
          >
            <TabsList className="rounded-2xl border bg-background p-1">
              <TabsTrigger value="monthly" className="rounded-xl font-medium data-[state=active]:bg-sidebar">
                Monthly
              </TabsTrigger>
              <TabsTrigger value="yearly" className="rounded-xl font-medium relative data-[state=active]:bg-sidebar">
                Yearly
                <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                  Save 17%
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {isPro && subscriptionStatus?.cancelAtPeriodEnd && (
          <div className="flex justify-center mb-8">
            <div className="text-sm text-orange-500">
              Your subscription will cancel at the end of the current period
            </div>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-5 md:gap-0">
          {/* Free Plan - Always First */}
          <div className="rounded-2xl flex flex-col justify-between space-y-8 border p-6 md:col-span-2 md:my-6 md:rounded-r-none md:border-r-0 lg:p-10">
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-medium">Free</h2>
                  {!isPro && (
                    <span className="text-xs bg-primary/10 text-primary px-3 py-1 rounded-full font-medium">
                      Current Plan
                    </span>
                  )}
                </div>
                <span className="my-3 block text-2xl font-semibold">$0 / forever</span>
              </div>

              {isPro && (
                <Button
                  onClick={handleUpgrade}
                  disabled={upgradeLoading || portalLoading}
                  variant="outline"
                  className="w-full">
                  {(upgradeLoading || portalLoading) ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    "Downgrade to Free"
                  )}
                </Button>
              )}


              <ul className="list-outside space-y-3 text-sm">
                {freePlanFeatures.map((item, index) => (
                  <li
                    key={index}
                    className="flex items-center gap-2">
                    <Check className="size-3" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Pro Plan - Always Second */}
          <div className="rounded-2xl border bg-sidebar p-6 md:col-span-3 lg:p-10">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="font-medium">Pro</h2>
                    {isPro && (
                      <span className="text-xs bg-primary/10 text-primary px-3 py-1 rounded-full font-medium">
                        Current Plan
                      </span>
                    )}
                  </div>
                  <span className="my-3 block text-2xl font-semibold">${proPrice} / {proPeriod}</span>
                  {isPro && subscriptionStatus?.status && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Status: <span className="capitalize font-medium">{subscriptionStatus.status}</span>
                    </p>
                  )}
                </div>

                {isPro ? (
                  needsBillingCycleChange ? (
                    <div className="space-y-2">
                      <Button
                        onClick={handleBillingCycleUpgrade}
                        disabled={upgradeLoading || portalLoading}
                        variant={selectedBillingCycle === "yearly" ? "default" : "outline"}
                        className="w-full">
                        {(upgradeLoading || portalLoading) ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Loading...
                          </>
                        ) : selectedBillingCycle === "yearly" ? (
                          "Upgrade to Yearly"
                        ) : (
                          "Downgrade to Monthly"
                        )}
                      </Button>
                      <Button
                        onClick={handleCancel}
                        disabled={portalLoading}
                        variant="outline"
                        className="w-full">
                        {portalLoading ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Loading...
                          </>
                        ) : (
                          "Manage Subscription"
                        )}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Button
                        onClick={handleCancel}
                        disabled={portalLoading}
                        variant="outline"
                        className="w-full">
                        {portalLoading ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Loading...
                          </>
                        ) : (
                          "Manage Subscription"
                        )}
                      </Button>
                      {subscriptionStatus?.cancelAtPeriodEnd && (
                        <p className="text-xs text-orange-500 text-center">
                          Cancels at period end
                        </p>
                      )}
                    </div>
                  )
                ) : (
                  <Button
                    onClick={handleUpgrade}
                    disabled={upgradeLoading || portalLoading}
                    variant="default"
                    className="w-full">
                    {upgradeLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      "Upgrade to Pro"
                    )}
                  </Button>
                )}
              </div>

              <div>
                <div className="text-sm font-medium">Everything in free plus :</div>

                <ul className="mt-4 list-outside space-y-3 text-sm">
                  {proPlanFeatures.map((item, index) => (
                    <li
                      key={index}
                      className="flex items-center gap-2">
                      <Check className="size-3" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Warning Dialog for Billing Cycle Change */}
        <Dialog 
          open={showWarningDialog} 
          onOpenChange={(open) => {
            setShowWarningDialog(open);
            if (!open) {
              // Revert to current billing cycle if dialog is closed
              setSelectedBillingCycle(currentBillingCycle);
              setPendingBillingCycle(null);
            }
          }}
        >
          <DialogContent className="rounded-2xl">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                </div>
                <DialogTitle className="text-xl">Change Billing Cycle?</DialogTitle>
              </div>
              <DialogDescription className="text-base pt-2">
                You are about to change your billing cycle from{" "}
                <strong className="font-semibold capitalize">{currentBillingCycle}</strong> to{" "}
                <strong className="font-semibold capitalize">{pendingBillingCycle}</strong>.
                <br />
                <br />
                This will create a new checkout session to update your subscription billing cycle.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowWarningDialog(false);
                  setSelectedBillingCycle(currentBillingCycle);
                  setPendingBillingCycle(null);
                }}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmBillingCycleChange}
                disabled={upgradeLoading}
                className="rounded-xl"
              >
                {upgradeLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

