'use client';

import React from 'react';
import { Rocket, Loader2 } from 'lucide-react';
import { AutopilotProgress as AutopilotProgressType, AutopilotState } from '@/types/events';
import { cn } from '@/lib/utils';

interface AutopilotProgressProps {
  progress: AutopilotProgressType;
  className?: string;
}

const stateLabels: Record<AutopilotState, string> = {
  off: 'Off',
  init: 'Starting',
  executing: 'Step',
  finishing: 'Completing',
};

/**
 * Compact autopilot indicator - shows current step only (adaptive, no total)
 * Rendered inline, not as a prominent UI element
 */
export function AutopilotProgress({ progress, className }: AutopilotProgressProps) {
  const { state, step, currentTask } = progress;

  if (state === 'off') return null;

  return (
    <div className={cn(
      "inline-flex items-center gap-2 px-2 py-1 rounded-md bg-indigo-500/10 text-xs",
      className
    )}>
      <Rocket className="h-3 w-3 text-indigo-500" />
      <span className="text-indigo-600 dark:text-indigo-400">
        {stateLabels[state]} {state === 'executing' ? step : ''}
      </span>
      {state === 'executing' && (
        <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />
      )}
    </div>
  );
}

// Alias for backward compatibility
export const AutopilotProgressCompact = AutopilotProgress;
