import { loadStripe, Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null>;

export const getStripe = () => {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
  }
  return stripePromise;
};

export const STRIPE_PRICES = {
  monthly: process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID || 'price_monthly',
  yearly: process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID || 'price_yearly',
};

export type BillingCycle = "monthly" | "yearly";

export interface CreditTier {
  credits: number;
  price: number;
  /** Per-month price when billed annually. */
  yearlyPrice: number;
  monthlyPriceId: string;
  yearlyPriceId: string;
}

const CREDIT_TIER_MONTHLY_PRICE_IDS: Record<number, string | undefined> = {
  500: process.env.NEXT_PUBLIC_STRIPE_CREDITS_500_PRICE_ID,
  1000: process.env.NEXT_PUBLIC_STRIPE_CREDITS_1000_PRICE_ID,
  1500: process.env.NEXT_PUBLIC_STRIPE_CREDITS_1500_PRICE_ID,
  2000: process.env.NEXT_PUBLIC_STRIPE_CREDITS_2000_PRICE_ID,
  2500: process.env.NEXT_PUBLIC_STRIPE_CREDITS_2500_PRICE_ID,
  3000: process.env.NEXT_PUBLIC_STRIPE_CREDITS_3000_PRICE_ID,
  3500: process.env.NEXT_PUBLIC_STRIPE_CREDITS_3500_PRICE_ID,
  4000: process.env.NEXT_PUBLIC_STRIPE_CREDITS_4000_PRICE_ID,
  4500: process.env.NEXT_PUBLIC_STRIPE_CREDITS_4500_PRICE_ID,
  5000: process.env.NEXT_PUBLIC_STRIPE_CREDITS_5000_PRICE_ID,
};

const CREDIT_TIER_YEARLY_PRICE_IDS: Record<number, string | undefined> = {
  500: process.env.NEXT_PUBLIC_STRIPE_CREDITS_500_YEARLY_PRICE_ID,
  1000: process.env.NEXT_PUBLIC_STRIPE_CREDITS_1000_YEARLY_PRICE_ID,
  1500: process.env.NEXT_PUBLIC_STRIPE_CREDITS_1500_YEARLY_PRICE_ID,
  2000: process.env.NEXT_PUBLIC_STRIPE_CREDITS_2000_YEARLY_PRICE_ID,
  2500: process.env.NEXT_PUBLIC_STRIPE_CREDITS_2500_YEARLY_PRICE_ID,
  3000: process.env.NEXT_PUBLIC_STRIPE_CREDITS_3000_YEARLY_PRICE_ID,
  3500: process.env.NEXT_PUBLIC_STRIPE_CREDITS_3500_YEARLY_PRICE_ID,
  4000: process.env.NEXT_PUBLIC_STRIPE_CREDITS_4000_YEARLY_PRICE_ID,
  4500: process.env.NEXT_PUBLIC_STRIPE_CREDITS_4500_YEARLY_PRICE_ID,
  5000: process.env.NEXT_PUBLIC_STRIPE_CREDITS_5000_YEARLY_PRICE_ID,
};

function resolveCreditTierPriceId(credits: number, cycle: BillingCycle): string {
  const priceIds =
    cycle === "yearly" ? CREDIT_TIER_YEARLY_PRICE_IDS : CREDIT_TIER_MONTHLY_PRICE_IDS;
  const priceId = priceIds[credits];
  if (priceId) {
    return priceId;
  }
  return cycle === "yearly"
    ? `price_credits_${credits}_yearly`
    : `price_credits_${credits}`;
}

export const CREDIT_TIERS: CreditTier[] = [
  { credits: 500, price: 25, yearlyPrice: 21 },
  { credits: 1000, price: 50, yearlyPrice: 42 },
  { credits: 1500, price: 75, yearlyPrice: 63 },
  { credits: 2000, price: 100, yearlyPrice: 84 },
  { credits: 2500, price: 125, yearlyPrice: 105 },
  { credits: 3000, price: 150, yearlyPrice: 126 },
  { credits: 3500, price: 175, yearlyPrice: 147 },
  { credits: 4000, price: 200, yearlyPrice: 168 },
  { credits: 4500, price: 225, yearlyPrice: 189 },
  { credits: 5000, price: 250, yearlyPrice: 210 },
].map((tier) => ({
  ...tier,
  monthlyPriceId: resolveCreditTierPriceId(tier.credits, "monthly"),
  yearlyPriceId: resolveCreditTierPriceId(tier.credits, "yearly"),
}));

export const DEFAULT_CREDIT_TIER =
  CREDIT_TIERS.find((tier) => tier.credits === 500) ?? CREDIT_TIERS[0];

export const DEFAULT_CREDIT_AMOUNT = DEFAULT_CREDIT_TIER.credits;

/** Per-month display price for the selected billing cycle. */
export function getTierMonthlyDisplayPrice(
  tier: CreditTier,
  cycle: BillingCycle
): number {
  return cycle === "yearly" ? tier.yearlyPrice : tier.price;
}

/** Total amount billed once per year. */
export function getTierAnnualTotal(tier: CreditTier): number {
  return tier.yearlyPrice * 12;
}

/** Savings vs paying the monthly rate for 12 months. */
export function getTierYearlySavings(tier: CreditTier): number {
  return tier.price * 12 - getTierAnnualTotal(tier);
}

/** @deprecated Prefer getTierMonthlyDisplayPrice or getTierAnnualTotal. */
export function getTierDisplayPrice(tier: CreditTier, cycle: BillingCycle): number {
  return cycle === "yearly" ? getTierAnnualTotal(tier) : tier.price;
}

export function getTierPriceId(tier: CreditTier, cycle: BillingCycle): string {
  return cycle === "yearly" ? tier.yearlyPriceId : tier.monthlyPriceId;
}

export function getCreditTierByCredits(credits: number): CreditTier | undefined {
  return CREDIT_TIERS.find((tier) => tier.credits === credits);
}

export function getCreditsForPriceId(priceId: string): number | undefined {
  return CREDIT_TIERS.find(
    (tier) => tier.monthlyPriceId === priceId || tier.yearlyPriceId === priceId
  )?.credits;
}

export function getBillingCycleForPriceId(priceId: string): BillingCycle | null {
  if (priceId === STRIPE_PRICES.yearly) return "yearly";
  if (priceId === STRIPE_PRICES.monthly) return "monthly";
  for (const tier of CREDIT_TIERS) {
    if (priceId === tier.yearlyPriceId) return "yearly";
    if (priceId === tier.monthlyPriceId) return "monthly";
  }
  return null;
}

