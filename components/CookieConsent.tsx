"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const COOKIE_CONSENT_KEY = "anybody-cookie-consent";
export const COOKIE_CONSENT_EVENT = "anybody-cookie-consent-change";

export type CookieConsentValue = "accepted" | "declined";

export function getCookieConsent(): CookieConsentValue | null {
  if (typeof window === "undefined") return null;
  const value = localStorage.getItem(COOKIE_CONSENT_KEY);
  if (value === "accepted" || value === "declined") return value;
  return null;
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(getCookieConsent() === null);
  }, []);

  const saveConsent = (value: CookieConsentValue) => {
    localStorage.setItem(COOKIE_CONSENT_KEY, value);
    window.dispatchEvent(
      new CustomEvent(COOKIE_CONSENT_EVENT, { detail: value })
    );
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[100] p-4 sm:p-6"
    >
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-xl border border-border bg-white/95 p-4 shadow-lg backdrop-blur-md dark:bg-black/95 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <p className="text-sm leading-relaxed text-black dark:text-white">
          We use cookies to ensure that we give you the best experience on our
          website. Read{" "}
          <Link
            href="/privacy"
            className="underline underline-offset-2 hover:text-[#da2a1d]"
          >
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => saveConsent("declined")}
            className="border-border"
          >
            Decline
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => saveConsent("accepted")}
            className="bg-[#da2a1d] text-white hover:bg-[#c0251a]"
          >
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
