"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STRIPE_PRICES } from "@/lib/stripe";
import { PRO_PLAN_FEATURES } from "@/lib/plan-features";
import { toast } from "sonner";
import pb from "@/lib/pocketbase";
import { useAuthRedirect } from "@/hooks/use-auth-redirect";

export default function ChoosePlanPage() {
  useAuthRedirect();
  
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(false);

  const price = billingCycle === "monthly" ? 20 : 200;
  const period = billingCycle === "monthly" ? "month" : "year";

  const handleUpgrade = async () => {
    try {
      setLoading(true);

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
    } catch (error) {
      console.error(error);
      toast.error("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background pb-16 md:pb-32">
      <div className="w-full max-w-5xl px-6">
        <div className="mx-auto max-w-2xl space-y-6 text-center mb-12 md:mb-24 pt-8 md:pt-12">
          <h1 className="text-center text-4xl font-semibold lg:text-5xl">Pricing that Scales with You</h1>
          <p className="text-muted-foreground">
            Upgrade to Pro to unlock all features
          </p>
        </div>

        <div className="flex justify-center mb-8">
          <Tabs
            value={billingCycle}
            onValueChange={(value) => setBillingCycle(value as "monthly" | "yearly")}
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

        <div className="max-w-2xl mx-auto">
          <div className="rounded-2xl border bg-sidebar p-6 lg:p-10">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <h2 className="font-medium mb-2">Pro</h2>
                  <span className="my-3 block text-2xl font-semibold">${price} / {period}</span>
                </div>

                <Button
                  onClick={handleUpgrade}
                  disabled={loading}
                  variant="default"
                  className="w-full">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    "Upgrade to Pro"
                  )}
                </Button>
              </div>

              <div>
                <div className="text-sm font-medium">What&apos;s included</div>

                <ul className="mt-4 list-outside space-y-3 text-sm">
                  {PRO_PLAN_FEATURES.map((item, index) => (
                    <li
                      key={index}
                      className="flex items-center gap-2">
                      <Check className="size-3" />
                      {item.label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
