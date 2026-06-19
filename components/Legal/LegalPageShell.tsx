import Background from "@/components/Home/Background";
import { Navbar } from "@/components/Home/Navbar";
import Footer from "@/components/Home/Footer";

interface LegalPageShellProps {
  title: string;
  lastUpdated?: string;
  children: React.ReactNode;
}

export function LegalPageShell({ title, lastUpdated, children }: LegalPageShellProps) {
  return (
    <>
      <Background />
      <div className="min-h-screen flex flex-col relative overflow-x-hidden">
        <Navbar />
        <main className="flex-1 bg-transparent pt-24 sm:pb-28">
          <div className="container mx-auto px-6 py-12 max-w-4xl">
            <div className="text-center mb-12 md:mb-16">
              <h1 className="text-4xl font-semibold lg:text-5xl text-foreground mb-4">
                {title}
              </h1>
              {lastUpdated && (
                <p className="text-muted-foreground">{lastUpdated}</p>
              )}
            </div>
            <div className="rounded-2xl border border-border/40 bg-white/60 dark:bg-black/40 backdrop-blur-lg p-6 md:p-10 lg:p-12">
              {children}
            </div>
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
