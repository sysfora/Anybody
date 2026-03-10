export type SubscriptionPlan = "free" | "pro";

export interface UserSubscription {
  plan: SubscriptionPlan;
  isOutOfLimits: boolean;
  projectCount?: number;
  maxProjects?: number;
}

interface PocketBaseUser {
  subscription?: string;
  plan?: string;
  [key: string]: unknown;
}

/**
 * Check if user is on free plan
 */
export function isFreePlan(user: PocketBaseUser | null | undefined): boolean {
  // Check if user has subscription field or plan field
  // Adjust based on your PocketBase schema
  const subscription = user?.subscription || user?.plan || "free";
  return subscription === "free" || !subscription || subscription === null;
}

/**
 * Check if user has reached project limit
 * This calls the API endpoint to check limits
 */
export async function checkProjectLimit(userId: string): Promise<boolean> {
  try {
    if (!userId) return false;

    const response = await fetch("/api/subscription/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      console.error("Error checking project limit:", response.statusText);
      // On error, allow the action (fail open)
      return false;
    }

    const data = await response.json();
    return data.isOutOfLimits || false;
  } catch (error) {
    console.error("Error checking project limit:", error);
    // On error, allow the action (fail open)
    return false;
  }
}

/**
 * Get user subscription info
 */
export async function getUserSubscription(userId: string): Promise<UserSubscription> {
  try {
    if (!userId) {
      return {
        plan: "free",
        isOutOfLimits: false,
      };
    }

    const response = await fetch("/api/subscription/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      return {
        plan: "free",
        isOutOfLimits: false,
      };
    }

    const data = await response.json();
    return {
      plan: data.plan || "free",
      isOutOfLimits: data.isOutOfLimits || false,
      projectCount: data.projectCount,
      maxProjects: data.maxProjects,
    };
  } catch (error) {
    console.error("Error getting user subscription:", error);
    return {
      plan: "free",
      isOutOfLimits: false,
    };
  }
}

/**
 * Check if user can create private projects
 * This calls the API endpoint to check subscription status
 */
export async function canCreatePrivateProject(userId: string): Promise<boolean> {
  try {
    if (!userId) return false;

    const response = await fetch("/api/subscription/can-create-private", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      console.error("Error checking private project permission:", response.statusText);
      // On error, deny the action (fail closed for security)
      return false;
    }

    const data = await response.json();
    return data.canCreatePrivate || false;
  } catch (error) {
    console.error("Error checking private project permission:", error);
    // On error, deny the action (fail closed for security)
    return false;
  }
}

