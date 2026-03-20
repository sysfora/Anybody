"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STRIPE_PRICES } from "@/lib/stripe";
import { toast } from "sonner";
import pb from "@/lib/pocketbase";

const features = [
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
  /** Page the user was on when the popup was triggered (e.g. "/" or "/chat"). */
  returnTo?: string;
  /** Text the user had typed before being interrupted. */
  pendingPrompt?: string;
  /** Visibility they had selected. */
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
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(false);

  const price = billingCycle === "monthly" ? 20 : 200;
  const period = billingCycle === "monthly" ? "mo" : "year";

  const getTitle = () => {
    if (reason === "private_project") {
      return "Private Projects Require Pro";
    }
    if (reason === "out_of_limits") {
      return "You've Reached Your Limit";
    }
    return "Upgrade To Pro";
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

      // Persist the user's context so we can restore it after Stripe returns.
      const resumeData: SubscriptionResumeData = {
        returnTo: returnTo ?? (typeof window !== "undefined" ? window.location.pathname : "/"),
        pendingPrompt: pendingPrompt ?? "",
        pendingVisibility: pendingVisibility ?? "public",
      };
      try {
        localStorage.setItem(SUBSCRIPTION_RESUME_KEY, JSON.stringify(resumeData));
      } catch {
        // localStorage unavailable (e.g. private browsing) — proceed anyway
      }

      const userEmail = pb.authStore.record?.email;

      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          priceId: STRIPE_PRICES[billingCycle],
          email: userEmail,
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
      <DialogContent className="max-w-lg rounded-2xl border-border p-0">
        <div className="p-6">
          <DialogHeader className="space-y-2 pb-4">
            <DialogTitle className="text-2xl font-bold text-center">
              {getTitle()}
            </DialogTitle>
            <DialogDescription className="text-center text-sm text-muted-foreground">
              {getDescription()}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Billing Tabs */}
            <div className="flex justify-center">
              <Tabs
                value={billingCycle}
                onValueChange={(value) => setBillingCycle(value as "monthly" | "yearly")}
                className="w-full"
              >
                <TabsList className="w-full rounded-xl bg-muted/50">
                  <TabsTrigger value="monthly" className="flex-1 rounded-lg text-sm font-medium">
                    Monthly
                  </TabsTrigger>
                  <TabsTrigger value="yearly" className="flex-1 rounded-lg text-sm font-medium relative">
                    Yearly
                    <span className="ml-1.5 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                      Save 17%
                    </span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Price Display */}
            <div className="text-center space-y-1">
              <div className="flex items-baseline justify-center gap-2">
                <span className="text-5xl font-bold tracking-tight">${price}</span>
                <span className="text-xl text-muted-foreground font-medium">/{period}</span>
              </div>
            </div>

            {/* Features List */}
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 gap-2.5">
                {features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="rounded-full bg-primary/10 p-1.5 flex-shrink-0">
                      <Check className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="text-sm text-foreground leading-relaxed">{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA Button */}
            <div className="space-y-3 pt-2">
              <Button
                onClick={handleUpgrade}
                disabled={loading}
                className="w-full rounded-xl h-11 text-base font-semibold"
                size="lg"
              >
                {loading ? "Processing..." : "Upgrade to Pro"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Cancel anytime. No hidden fees.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

