'use client';

import { Sidebar } from "@/components/Dashboard/Sidebar";
import { NavigationBar } from "@/components/NavigationBar";
import { TeamManagement } from "@/components/Dashboard/TeamManagement";
import { useAuthRedirect } from "@/hooks/use-auth-redirect";

export default function TeamPage() {
  useAuthRedirect();

  return (
    <div className="min-h-screen">
      <NavigationBar variant="sidebar" />
      <Sidebar />
      <main className="md:ml-16 pt-14">
        <div className="h-[calc(100vh-3.5rem)] overflow-auto pb-16 md:pb-0">
          <div className="mx-auto max-w-4xl p-8">
            <div className="mb-8">
              <h1 className="mb-2 font-bold text-3xl">Team</h1>
              <p className="text-muted-foreground">Invite and manage team members</p>
            </div>
            <TeamManagement />
          </div>
        </div>
      </main>
    </div>
  );
}