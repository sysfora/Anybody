'use client';

import { Sidebar } from "@/components/Dashboard/Sidebar";
import { NavigationBar } from "@/components/NavigationBar";
import { ProjectsList } from "@/components/Dashboard/ProjectsList";

export default function ProjectsPage() {
  return (
    <div className="min-h-screen">
      <NavigationBar variant="sidebar" />
      <Sidebar />
      <main className="md:ml-16 pt-14">
        <div className="h-[calc(100vh-3.5rem)] overflow-auto pb-16 md:pb-0">
          <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
            <div className="mb-6 sm:mb-8">
              <h1 className="mb-2 font-bold text-2xl sm:text-3xl">Projects</h1>
              <p className="text-muted-foreground text-sm sm:text-base">Manage your AI-generated applications</p>
            </div>
            <ProjectsList />
          </div>
        </div>
      </main>
    </div>
  );
}