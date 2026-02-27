'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Brain, FileSearch, PhoneCall, RefreshCw, Check, ArrowRight } from 'lucide-react';

interface Step {
  id: number;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

const steps: Step[] = [
  {
    id: 1,
    label: 'Quick Snapshot',
    description: 'AI generates company overview',
    icon: <Brain className="h-6 w-6" />,
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
  },
  {
    id: 2,
    label: 'Deep Analysis',
    description: 'Scoring & content discovery',
    icon: <FileSearch className="h-6 w-6" />,
    color: 'text-green-600',
    bgColor: 'bg-green-100',
  },
  {
    id: 3,
    label: 'Call Analysis',
    description: 'Fireflies notes integration',
    icon: <PhoneCall className="h-6 w-6" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  {
    id: 4,
    label: 'Rescoring',
    description: 'Updated score with call data',
    icon: <RefreshCw className="h-6 w-6" />,
    color: 'text-rose-600',
    bgColor: 'bg-rose-100',
  },
];

// Realistic timing for each step (in milliseconds) - Total 4 seconds
const stepTimings = [800, 1200, 1100, 900]; // Quick start, longer analysis, moderate call check, fast rescore

interface AnalysisStepsProps {
  contactName?: string;
}

export function AnalysisSteps({ contactName }: AnalysisStepsProps) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    // Progress through steps with realistic timing
    const progressToNextStep = (stepIndex: number) => {
      if (stepIndex >= steps.length - 1) return;
      
      const delay = stepTimings[stepIndex];
      setTimeout(() => {
        setActiveStep(stepIndex + 1);
        progressToNextStep(stepIndex + 1);
      }, delay);
    };

    progressToNextStep(0);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <div className="max-w-3xl w-full">
        {/* Title */}
        <div className="text-center mb-10">
          <h2 className="text-xl font-semibold mb-2">
            Analyzing {contactName || 'Lead'}
          </h2>
          <p className="text-sm text-muted-foreground">
            Running AI-powered evaluation pipeline
          </p>
        </div>

        {/* Steps */}
        <div className="flex items-start justify-between gap-2">
          {steps.map((step, index) => {
            const isActive = index === activeStep;
            const isComplete = index < activeStep;
            const isPending = index > activeStep;

            return (
              <div key={step.id} className="flex items-start flex-1">
                {/* Step */}
                <div className="flex flex-col items-center text-center flex-1">
                  {/* Icon */}
                  <div
                    className={cn(
                      'relative w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-500',
                      isComplete && 'bg-green-100 text-green-600',
                      isActive && cn(step.bgColor, step.color, 'ring-2 ring-offset-2 ring-current shadow-lg scale-110'),
                      isPending && 'bg-muted text-muted-foreground'
                    )}
                  >
                    {isComplete ? (
                      <Check className="h-6 w-6" />
                    ) : (
                      <span className={cn(
                        isActive && 'animate-pulse'
                      )}>
                        {step.icon}
                      </span>
                    )}
                  </div>

                  {/* Label */}
                  <p
                    className={cn(
                      'mt-3 text-sm font-medium transition-colors duration-300',
                      isActive && 'text-foreground',
                      isComplete && 'text-green-700',
                      isPending && 'text-muted-foreground'
                    )}
                  >
                    {step.label}
                  </p>

                  {/* Description */}
                  <p
                    className={cn(
                      'mt-1 text-xs max-w-[120px] transition-colors duration-300',
                      isActive && 'text-muted-foreground',
                      isComplete && 'text-green-600/70',
                      isPending && 'text-muted-foreground/50'
                    )}
                  >
                    {step.description}
                  </p>
                </div>

                {/* Arrow between steps */}
                {index < steps.length - 1 && (
                  <div className="flex items-center pt-5 px-1">
                    <ArrowRight
                      className={cn(
                        'h-4 w-4 transition-colors duration-300',
                        isComplete ? 'text-green-400' : 'text-muted-foreground/30'
                      )}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="mt-10 w-full bg-muted rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
            style={{ width: `${((activeStep + 1) / steps.length) * 100}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground text-center mt-3">
          Step {activeStep + 1} of {steps.length} &mdash; {steps[activeStep]?.label}
        </p>
      </div>
    </div>
  );
}
