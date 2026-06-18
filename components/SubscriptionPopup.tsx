"use client";

import { useState } from "react";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreditTierDropdown } from "@/components/ui/credit-tier-dropdown";
import { Switch } from "@/components/ui/switch";
import {
  CREDIT_TIERS,
  DEFAULT_CREDIT_TIER,
  getTierDisplayPrice,
  getTierPriceId,
  type BillingCycle,
  type CreditTier,
} from "@/lib/stripe";
import { PRO_PLAN_FEATURES } from "@/lib/plan-features";
import { toast } from "sonner";
import pb from "@/lib/pocketbase";

export const SUBSCRIPTION_RESUME_KEY = "subscriptionResume";

export interface SubscriptionResumeData {
  returnTo: string;
  pendingPrompt: string;
  pendingVisibility: string;
}

interface SubscriptionPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: "private_project" | "out_of_limits";
  returnTo?: string;
  pendingPrompt?: string;
  pendingVisibility?: string;
}

export function SubscriptionPopup({
  open,
  onOpenChange,
  reason,
  returnTo,
  pendingPrompt,
  pendingVisibility,
}: SubscriptionPopupProps) {
  const [selectedTier, setSelectedTier] = useState<CreditTier>(DEFAULT_CREDIT_TIER);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [loading, setLoading] = useState(false);

  const monthlyPrice = selectedTier.price;
  const annualTotal = getTierDisplayPrice(selectedTier, "yearly");

  const getTitle = () => {
    if (reason === "private_project") {
      return "Private Projects Require Pro";
    }
    if (reason === "out_of_limits") {
      return "You've Reached Your Limit";
    }
    return "Upgrade to Pro";
  };

  const getDescription = () => {
    if (reason === "private_project") {
      return "Private projects are available for Pro subscribers. Upgrade to unlock this feature and more.";
    }
    if (reason === "out_of_limits") {
      return "You've reached your project limit. Upgrade to Pro for unlimited projects and more features.";
    }
    return "Unlock all features and take your projects to the next level";
  };

  const handleUpgrade = async () => {
    try {
      setLoading(true);

      const resumeData: SubscriptionResumeData = {
        returnTo: returnTo ?? (typeof window !== "undefined" ? window.location.pathname : "/"),
        pendingPrompt: pendingPrompt ?? "",
        pendingVisibility: pendingVisibility ?? "public",
      };
      try {
        localStorage.setItem(SUBSCRIPTION_RESUME_KEY, JSON.stringify(resumeData));
      } catch {
        // localStorage unavailable — proceed anyway
      }

      const userId = pb.authStore.record?.id;
      const userEmail = pb.authStore.record?.email;

      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          priceId: getTierPriceId(selectedTier, billingCycle),
          email: userEmail,
          userId,
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
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 dark:bg-[#171717] sm:max-w-lg">
        <div className="space-y-6 p-6">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="text-2xl font-bold tracking-tight sm:text-3xl">
              {getTitle()}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {getDescription()}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            <div
              key={monthlyPrice}
              className="flex items-baseline justify-start gap-1 animate-in fade-in duration-200"
            >
              <span className="text-4xl font-bold tabular-nums tracking-tight">
                ${monthlyPrice}
              </span>
              <span className="text-base text-muted-foreground">/ month</span>
            </div>
            {billingCycle === "yearly" ? (
              <p className="text-sm text-muted-foreground animate-in fade-in duration-200">
                Billed annually at ${annualTotal}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-start gap-3">
            <Switch
              id="popup-billing-cycle"
              size="lg"
              checked={billingCycle === "yearly"}
              onCheckedChange={(checked) =>
                setBillingCycle(checked ? "yearly" : "monthly")
              }
              disabled={loading}
            />
            <label
              htmlFor="popup-billing-cycle"
              className="text-sm font-medium text-foreground cursor-pointer select-none"
            >
              Annual
            </label>
          </div>

          <Button
            onClick={handleUpgrade}
            disabled={loading}
            className="h-11 w-full rounded-xl text-base font-semibold transition-all duration-200 hover:opacity-90"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Processing...
              </>
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
            disabled={loading}
          />

          <section aria-label="Plan features">
            <ul className="space-y-3">
              {PRO_PLAN_FEATURES.map(({ label }) => (
                <li key={label} className="flex items-center gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#F5F5F5] dark:bg-[#262626]">
                    <Check className="size-3.5 text-foreground" aria-hidden />
                  </span>
                  <span className="text-sm text-foreground">{label}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
