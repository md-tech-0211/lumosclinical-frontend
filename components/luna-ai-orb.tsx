'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Luna AI mark — calm motion: slow orbit ring, soft halo, light center pulse.
 * Avoids fast spins / 3D tilt so it reads as a product logo, not a loader.
 */
export function LunaAiOrb({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative mx-auto mb-5 flex h-[7.25rem] w-[7.25rem] items-center justify-center',
        className,
      )}
      aria-hidden
    >
      {/* Ambient halo */}
      <div className="pointer-events-none absolute inset-[-12%] rounded-full bg-primary/20 blur-2xl animate-luna-ai-halo" />

      {/* Single slow gradient ring */}
      <div
        className="absolute inset-0 animate-luna-ai-orbit-ring rounded-full"
        style={{
          background:
            'conic-gradient(from 0deg, hsl(var(--primary) / 0.95), hsl(var(--chart-3) / 0.75), hsl(var(--accent) / 0.7), hsl(var(--primary) / 0.95))',
          maskImage:
            'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))',
          WebkitMaskImage:
            'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))',
        }}
      />

      {/* Quiet inner ring (static) */}
      <div
        className="absolute inset-[10px] rounded-full border border-primary/12 bg-background/40 shadow-inner ring-1 ring-border/30 backdrop-blur-[2px]"
        aria-hidden
      />

      {/* Core */}
      <div className="relative z-10 flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full bg-background/90 shadow-sm ring-1 ring-primary/20 backdrop-blur-sm animate-luna-ai-core-pulse">
        <Sparkles
          className="h-6 w-6 text-primary drop-shadow-[0_0_10px_hsl(var(--primary)/0.45)] animate-luna-ai-sparkle"
          strokeWidth={1.75}
        />
      </div>
    </div>
  );
}
