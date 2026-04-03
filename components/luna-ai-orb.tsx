'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Decorative “AI core” — layered motion: orbit, counter-orbit, pulse, float. */
export function LunaAiOrb({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative mx-auto mb-5 flex h-[7.25rem] w-[7.25rem] items-center justify-center',
        'animate-luna-ai-float',
        className
      )}
      aria-hidden
    >
      {/* Soft outer glow */}
      <div className="absolute inset-0 rounded-full bg-primary/15 blur-xl animate-luna-ai-glow" />

      {/* Counter-rotating color ring */}
      <div className="absolute inset-0 animate-luna-ai-spin-reverse rounded-full p-[2px]">
        <div className="h-full w-full rounded-full bg-[conic-gradient(from_180deg,hsl(var(--primary)),hsl(var(--chart-3)),hsl(var(--accent)),hsl(var(--primary)))] opacity-90" />
      </div>

      {/* Main rotating ring */}
      <div className="absolute inset-[5px] animate-luna-ai-spin rounded-full p-[2px]">
        <div className="h-full w-full rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,hsl(var(--primary))_90deg,transparent_180deg,hsl(var(--chart-3))_270deg,transparent_360deg)]" />
      </div>

      {/* Inner disc (masks center) */}
      <div className="absolute inset-[11px] rounded-full bg-background shadow-inner ring-1 ring-border/40" />

      {/* Glowing core */}
      <div className="absolute inset-[14px] animate-luna-ai-pulse-soft rounded-full bg-gradient-to-br from-primary/35 via-chart-3/25 to-primary/20 shadow-[inset_0_0_24px_hsl(var(--primary)/0.25)]" />

      {/* Orbiting spark dots */}
      <div className="absolute inset-0 animate-luna-ai-spin">
        <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />
      </div>
      <div className="absolute inset-0 animate-luna-ai-spin-reverse-mid">
        <span className="absolute bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-chart-3 shadow-[0_0_8px_hsl(var(--chart-3))]" />
      </div>
      <div className="absolute inset-0 animate-luna-ai-spin-slow">
        <span className="absolute right-1 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_6px_hsl(var(--accent))]" />
      </div>

      {/* Center icon */}
      <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full bg-background/80 shadow-md ring-1 ring-primary/20 backdrop-blur-sm">
        <Sparkles className="h-6 w-6 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" strokeWidth={1.75} />
      </div>
    </div>
  );
}
