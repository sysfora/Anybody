/**
 * Check if auto-reload should be triggered and process it
 * This should be called whenever credits are used/deducted or checked
 * 
 * @param userId - The user ID to check auto-reload for
 * @returns Promise<boolean> - Returns true if auto-reload was successfully processed, false otherwise
 */
export async function checkAndProcessAutoReload(userId: string): Promise<boolean> {
  try {
    const response = await fetch('/api/credits/auto-reload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      const error = await response.json();
      // Don't throw error if auto-reload is not enabled or credits are above threshold
      if (
        error.error?.includes('not enabled') || 
        error.error?.includes('above threshold') ||
        error.message?.includes('above threshold')
      ) {
        return false;
      }
      console.error('Auto-reload check failed:', error);
      return false;
    }

    const data = await response.json();
    if (data.success) {
      console.log('Auto-reload processed:', data);
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error checking auto-reload:', error);
    return false;
  }
}

