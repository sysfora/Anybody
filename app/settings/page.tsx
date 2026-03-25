'use client';

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/Dashboard/Sidebar";
import { NavigationBar } from "@/components/NavigationBar";
import { SettingsForm } from "@/components/Dashboard/SettingsForm";
import { useAuthRedirect } from "@/hooks/use-auth-redirect";

function SettingsPageContent() {
  useAuthRedirect();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? undefined;

  return (
    <div className="min-h-screen">
      <NavigationBar variant="sidebar" />
      <Sidebar />
      <main className="md:ml-16 pt-14">
        <div className="h-[calc(100vh-3.5rem)] overflow-auto pb-16 md:pb-0" id="settings-scroll-container">
          <div className="mx-auto max-w-4xl p-8">
            <div className="mb-8">
              <h1 className="mb-2 font-bold text-3xl">Settings</h1>
              <p className="text-muted-foreground">Manage your account settings and preferences</p>
            </div>
            <SettingsForm scrollTo={tab} />
          </div>
        </div>
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsPageContent />
    </Suspense>
  );
}