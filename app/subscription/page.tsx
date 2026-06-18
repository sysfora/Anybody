"use client";

import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreditTierDropdown } from "@/components/ui/credit-tier-dropdown";
import { Switch } from "@/components/ui/switch";
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
import {
  CREDIT_TIERS,
  DEFAULT_CREDIT_TIER,
  getCreditTierByCredits,
  getTierAnnualTotal,
  getTierMonthlyDisplayPrice,
  getTierYearlySavings,
  getTierPriceId,
  type BillingCycle,
  type CreditTier,
} from "@/lib/stripe";
import { PRO_PLAN_FEATURES } from "@/lib/plan-features";
import { Sidebar } from "@/components/Dashboard/Sidebar";
import { NavigationBar } from "@/components/NavigationBar";

interface SubscriptionStatus {
  hasActiveSubscription: boolean;
  plan: "free" | "pro";
  billingCycle: "monthly" | "yearly" | null;
  subscriptionCredits?: number;
  status: string | null;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}

interface PocketBaseUser {
  id: string;
  email?: string;
  plan?: string;
  stripe_id?: string;
  credits?: number;
  [key: string]: unknown;
}

export default function SubscriptionPage() {
  const router = useRouter();
  const [user, setUser] = useState<PocketBaseUser | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [selectedTier, setSelectedTier] = useState<CreditTier>(DEFAULT_CREDIT_TIER);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [selectedBillingCycle, setSelectedBillingCycle] =
    useState<BillingCycle>("monthly");
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [pendingBillingCycle, setPendingBillingCycle] = useState<
    BillingCycle | null
  >(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userId = pb.authStore.record?.id;
        if (!userId) {
          router.push("/login");
          return;
        }

        const profileRes = await fetch("/api/user/get-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        let userData: PocketBaseUser | null = null;
        if (profileRes.ok) {
          userData = await profileRes.json();
          setUser(userData);

          const tierFromCredits = getCreditTierByCredits(userData?.credits ?? 0);
          if (tierFromCredits) {
            setSelectedTier(tierFromCredits);
          }
        }

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

          if (status.billingCycle) {
            setBillingCycle(status.billingCycle);
            setSelectedBillingCycle(status.billingCycle);
          }

          if (status.subscriptionCredits) {
            const tierFromSubscription = getCreditTierByCredits(
              status.subscriptionCredits
            );
            if (tierFromSubscription) {
              setSelectedTier(tierFromSubscription);
            }
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
      const userId = pb.authStore.record?.id;

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

  const handleBillingCycleChange = (newCycle: BillingCycle) => {
    setSelectedBillingCycle(newCycle);

    if (!hasActiveSubscription) {
      setBillingCycle(newCycle);
    }
  };

  const handleConfirmBillingCycleChange = async () => {
    if (!pendingBillingCycle) return;

    try {
      setSubscribeLoading(true);
      setShowWarningDialog(false);

      const userId = pb.authStore.record?.id;
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          priceId: getTierPriceId(selectedTier, pendingBillingCycle),
          email: user?.email || pb.authStore.record?.email,
          userId: userId,
          credits: selectedTier.credits,
          billingCycle: pendingBillingCycle,
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
      setSubscribeLoading(false);
    }
  };

  const handleBillingCycleChangeConfirm = async () => {
    if (!hasActiveSubscription) return;

    const targetCycle = selectedBillingCycle;
    if (targetCycle === currentBillingCycle) {
      await handleCancel();
      return;
    }

    setPendingBillingCycle(targetCycle);
    setShowWarningDialog(true);
  };

  const handleSubscribe = async () => {
    try {
      setSubscribeLoading(true);
      const userId = pb.authStore.record?.id;

      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          priceId: getTierPriceId(selectedTier, billingCycle),
          email: user?.email || pb.authStore.record?.email,
          userId: userId,
          credits: selectedTier.credits,
          billingCycle,
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
      setSubscribeLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <NavigationBar variant="sidebar" />
        <Sidebar />
        <main className="md:ml-16 pt-14">
          <div className="h-[calc(100vh-3.5rem)] overflow-auto flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </main>
      </div>
    );
  }

  const hasActiveSubscription =
    subscriptionStatus?.hasActiveSubscription ?? false;
  const currentBillingCycle = subscriptionStatus?.billingCycle || billingCycle;
  const displayBillingCycle = hasActiveSubscription
    ? selectedBillingCycle
    : billingCycle;
  const displayPrice = getTierMonthlyDisplayPrice(
    selectedTier,
    displayBillingCycle
  );
  const annualTotal = getTierAnnualTotal(selectedTier);
  const yearlySavings = getTierYearlySavings(selectedTier);
  const needsBillingCycleChange =
    hasActiveSubscription && selectedBillingCycle !== currentBillingCycle;
  const isActionLoading = subscribeLoading || portalLoading;

  const handleUpgrade = async () => {
    if (hasActiveSubscription) {
      if (needsBillingCycleChange) {
        await handleBillingCycleChangeConfirm();
        return;
      }
      await handleCancel();
      return;
    }
    await handleSubscribe();
  };

  return (
    <div className="min-h-screen">
      <NavigationBar variant="sidebar" />
      <Sidebar />
      <main className="md:ml-16 pt-14">
        <div className="h-[calc(100vh-3.5rem)] overflow-auto">
          <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
            <div
              role="dialog"
              aria-labelledby="subscription-title"
              className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-background shadow-lg dark:bg-[#171717] sm:max-w-lg"
            >
              <div className="space-y-6 p-6">
                <header className="space-y-2">
                  <h1
                    id="subscription-title"
                    className="text-2xl font-bold tracking-tight sm:text-3xl"
                  >
                    Upgrade to Pro
                  </h1>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Unlock all features and take your projects to the next level
                  </p>
                </header>

                {hasActiveSubscription && subscriptionStatus?.cancelAtPeriodEnd && (
                  <p className="text-sm text-muted-foreground">
                    Your subscription will cancel at the end of the current
                    period.
                  </p>
                )}

                <div className="space-y-1">
                  <div
                    key={displayPrice}
                    className="flex items-baseline justify-between gap-3 animate-in fade-in duration-200"
                  >
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold tabular-nums tracking-tight">
                        ${displayPrice}
                      </span>
                      <span className="text-base text-muted-foreground">
                        / month
                      </span>
                    </div>
                    {displayBillingCycle === "yearly" ? (
                      <span className="shrink-0 text-sm font-medium text-primary">
                        Save ${yearlySavings}
                      </span>
                    ) : null}
                  </div>
                  {displayBillingCycle === "yearly" ? (
                    <p className="text-sm text-muted-foreground animate-in fade-in duration-200">
                      Billed annually at ${annualTotal}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center justify-start gap-3">
                  <Switch
                    id="billing-cycle"
                    size="lg"
                    checked={displayBillingCycle === "yearly"}
                    onCheckedChange={(checked) =>
                      handleBillingCycleChange(checked ? "yearly" : "monthly")
                    }
                    disabled={isActionLoading}
                  />
                  <label
                    htmlFor="billing-cycle"
                    className="text-sm font-medium text-foreground cursor-pointer select-none"
                  >
                    Annual
                  </label>
                </div>

                <Button
                  onClick={handleUpgrade}
                  disabled={isActionLoading}
                  className="h-11 w-full rounded-xl text-base font-semibold transition-all duration-200 hover:opacity-90"
                  size="lg"
                >
                  {isActionLoading ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {hasActiveSubscription ? "Loading..." : "Processing..."}
                    </>
                  ) : hasActiveSubscription ? (
                    needsBillingCycleChange
                      ? displayBillingCycle === "yearly"
                        ? "Switch to Annual"
                        : "Switch to Monthly"
                      : "Manage Subscription"
                  ) : (
                    "Upgrade"
                  )}
                </Button>

                <CreditTierDropdown
                  tiers={CREDIT_TIERS}
                  value={selectedTier}
                  onValueChange={setSelectedTier}
                  billingCycle="monthly"
                  showPrices={false}
                  disabled={isActionLoading || hasActiveSubscription}
                />

                <section aria-label="Plan features">
                  <ul className="space-y-3">
                    {PRO_PLAN_FEATURES.map(({ label }) => (
                      <li
                        key={label}
                        className="flex items-center gap-3"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#F5F5F5] dark:bg-[#262626]">
                          <Check className="size-3.5 text-foreground" aria-hidden />
                        </span>
                        <span className="text-sm text-foreground">{label}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Dialog
        open={showWarningDialog}
        onOpenChange={(open) => {
          setShowWarningDialog(open);
          if (!open) {
            setSelectedBillingCycle(currentBillingCycle);
            setPendingBillingCycle(null);
          }
        }}
      >
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <div className="mb-2 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <AlertTriangle className="size-5 text-foreground" />
              </div>
              <DialogTitle className="text-xl">
                Change Billing Cycle?
              </DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-base">
              You are about to change your billing cycle from{" "}
              <strong className="font-semibold capitalize">
                {currentBillingCycle}
              </strong>{" "}
              to{" "}
              <strong className="font-semibold capitalize">
                {pendingBillingCycle}
              </strong>
              .
              <br />
              <br />
              This will create a new checkout session to update your
              subscription billing cycle.
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
              disabled={subscribeLoading}
              className="rounded-xl"
            >
              {subscribeLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
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
  );
}
