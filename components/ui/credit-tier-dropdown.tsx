"use client";

import { ChevronDown, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { BillingCycle, CreditTier } from "@/lib/stripe";
import { getTierDisplayPrice } from "@/lib/stripe";

interface CreditTierDropdownProps {
  tiers: CreditTier[];
  value: CreditTier;
  onValueChange: (tier: CreditTier) => void;
  billingCycle: BillingCycle;
  className?: string;
  disabled?: boolean;
  showPrices?: boolean;
}

export function CreditTierDropdown({
  tiers,
  value,
  onValueChange,
  billingCycle,
  className,
  disabled = false,
  showPrices = true,
}: CreditTierDropdownProps) {
  const displayPrice = getTierDisplayPrice(value, billingCycle);
  const formatCreditsLabel = (credits: number) =>
    `${credits.toLocaleString()} credits / month`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled} className="group">
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full h-auto rounded-lg border-border bg-background hover:bg-accent/50 px-3 py-3",
            "flex items-center justify-between gap-3 text-left font-normal shadow-none transition-all duration-200",
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-md bg-primary/10 p-2 shrink-0">
              <Coins className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {formatCreditsLabel(value.credits)}
              </p>
              {showPrices && (
                <p className="text-xs text-muted-foreground">
                  {billingCycle === "yearly" ? "Billed annually" : "Billed monthly"}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showPrices && (
              <span className="text-base font-semibold tabular-nums text-foreground">
                ${displayPrice}
              </span>
            )}
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-64 overflow-y-auto rounded-xl border border-border bg-background p-1.5 shadow-md"
      >
        {tiers.map((tier) => {
          const isSelected = tier.credits === value.credits;
          const tierPrice = getTierDisplayPrice(tier, billingCycle);
          return (
            <DropdownMenuItem
              key={tier.credits}
              onClick={() => onValueChange(tier)}
              className={cn(
                "flex items-center rounded-lg px-3 py-2.5 cursor-pointer",
                showPrices ? "justify-between gap-3" : "justify-start",
                isSelected && "bg-primary/10"
              )}
            >
              <span className="text-sm font-medium">
                {formatCreditsLabel(tier.credits)}
              </span>
              {showPrices && (
                <span
                  className={cn(
                    "text-sm font-semibold",
                    isSelected ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  ${tierPrice}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
