'use client';

import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRouter } from 'next/navigation';

interface AutoReloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AutoReloadDialog({ open, onOpenChange }: AutoReloadDialogProps) {
  const router = useRouter();

  const handleGoToSettings = () => {
    onOpenChange(false);
    router.push('/settings?tab=credits');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl border-border p-0">
        <div className="p-6 space-y-5">
          <DialogHeader className="space-y-3">
            <div className="flex justify-center">
              <div className="rounded-full bg-muted p-3">
                <Zap className="h-6 w-6 text-foreground" />
              </div>
            </div>
            <DialogTitle className="text-xl font-bold text-center">
              Out of Credits
            </DialogTitle>
            <DialogDescription className="text-center text-sm text-muted-foreground leading-relaxed">
              You&apos;ve used all your credits. Enable auto-reload to automatically
              top up your balance and keep generating without interruption.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">How auto-reload works</p>
            <p>When your credits drop below your threshold, we automatically charge your payment method and add credits to your account.</p>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <Button
              className="w-full rounded-xl h-10 font-semibold"
              onClick={handleGoToSettings}
            >
              Enable Auto-Reload
            </Button>
            <Button
              variant="ghost"
              className="w-full rounded-xl h-10 text-muted-foreground"
              onClick={() => onOpenChange(false)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
