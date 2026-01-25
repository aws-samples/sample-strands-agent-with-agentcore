'use client';

import React, { useState, useEffect } from 'react';
import { ChevronDown, Bot, Wrench, Sparkles, ArrowRight } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { SwarmProgress as SwarmProgressType, SWARM_AGENT_DISPLAY_NAMES, SwarmAgentStep } from '@/types/events';
import { Markdown } from '@/components/ui/Markdown';
import { cn } from '@/lib/utils';

interface SwarmProgressProps {
  progress: SwarmProgressType;
  className?: string;
}

/**
 * Swarm progress indicator - integrated into message flow
 * - Running: shows collapsible agent progress + streaming response
 * - Completed: collapsible "Show agents" + final response
 */
export function SwarmProgress({ progress, className }: SwarmProgressProps) {
  const [isExpanded, setIsExpanded] = useState(true); // Auto-expand during running
  const { isActive, currentNode, status, currentAction, agentSteps } = progress;

  // Auto-collapse when completed
  useEffect(() => {
    if (status === 'completed' || status === 'failed') {
      setIsExpanded(false);
    }
  }, [status]);

  if (!isActive && status === 'idle') return null;

  const displayName = SWARM_AGENT_DISPLAY_NAMES[currentNode] || currentNode;
  const isComplete = status === 'completed' || status === 'failed';

  // Filter steps: exclude coordinator
  const allSteps = agentSteps?.filter(step => step.nodeId !== 'coordinator') || [];

  // Responder's response is the final response
  const responderStep = allSteps.find(step => step.nodeId === 'responder');
  const finalResponse = responderStep?.responseText?.trim() || '';

  // All non-responder agents go to intermediate (including their responses)
  const intermediateSteps = allSteps.filter(step => step.nodeId !== 'responder');

  // Check if there's any content to show in agents section
  const hasAgentContent = intermediateSteps.some(s =>
    s.reasoningText?.trim() || s.responseText?.trim() ||
    (s.toolCalls && s.toolCalls.length > 0) || s.handoffMessage || s.handoffContext
  );

  // Current agent (last one in the list)
  const currentStep = allSteps[allSteps.length - 1];
  const isResponderActive = currentStep?.nodeId === 'responder';

  return (
    <div className={cn("flex justify-start mb-4 group", className)}>
      <div className="flex items-start space-x-4 max-w-4xl w-full min-w-0">
        {/* Bot Avatar */}
        <Avatar className="h-9 w-9 flex-shrink-0 mt-1">
          <AvatarFallback className="text-white bg-gradient-to-br from-purple-500 to-indigo-600">
            <Bot className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>

        {/* Content */}
        <div className="flex-1 pt-0.5 min-w-0 space-y-3">
          {/* Agents section - collapsible */}
          {(hasAgentContent || !isComplete) && (
            <div className="mb-2">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                <Sparkles className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">
                  {isComplete ? 'Show agents' : (currentAction || `${displayName} working...`)}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform duration-200",
                    isExpanded && "rotate-180"
                  )}
                />
              </button>

              {/* Expanded content - agent steps */}
              {isExpanded && (
                <div className="mt-2 border-l-2 border-blue-500/30 pl-4 space-y-3 animate-fade-in">
                  {intermediateSteps.map((step, index) => (
                    <AgentStepSection
                      key={`${step.nodeId}-${index}`}
                      step={step}
                      isRunning={!isComplete && index === intermediateSteps.length - 1 && !isResponderActive}
                    />
                  ))}

                  {/* Responder generating final response */}
                  {!isComplete && isResponderActive && (
                    <div className="text-xs text-muted-foreground italic">
                      Generating response...
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Final response from last responding agent */}
          {finalResponse && (
            <div className="chat-chart-content">
              <Markdown>{finalResponse}</Markdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Individual agent step section
 */
function AgentStepSection({ step, isRunning }: { step: SwarmAgentStep; isRunning?: boolean }) {
  const duration = step.endTime && step.startTime
    ? Math.round((step.endTime - step.startTime) / 1000)
    : null;

  const hasReasoning = step.reasoningText && step.reasoningText.trim().length > 0;
  const hasResponse = step.responseText && step.responseText.trim().length > 0;
  const hasToolCalls = step.toolCalls && step.toolCalls.length > 0;
  const hasHandoff = step.handoffMessage && step.handoffMessage.trim().length > 0;
  const hasContext = step.handoffContext && Object.keys(step.handoffContext).length > 0;

  // Show even if just running (for real-time feedback)
  if (!hasReasoning && !hasToolCalls && !hasResponse && !hasHandoff && !hasContext && !isRunning) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      {/* Agent header */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">
          {step.displayName}
        </span>
        {duration !== null && (
          <span className="text-xs text-muted-foreground">
            ({duration}s)
          </span>
        )}
        {isRunning && (
          <span className="flex gap-0.5">
            <span className="w-1 h-1 bg-blue-500 rounded-full animate-pulse"></span>
            <span className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }}></span>
            <span className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }}></span>
          </span>
        )}
      </div>

      {/* Reasoning text */}
      {hasReasoning && (
        <div className="text-sm text-muted-foreground/80 italic leading-relaxed">
          {step.reasoningText}
        </div>
      )}

      {/* Tool calls */}
      {hasToolCalls && (
        <div className="flex flex-wrap gap-1.5">
          {step.toolCalls!.map((tool, i) => (
            <span
              key={`${tool.toolName}-${i}`}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs",
                tool.status === 'completed' && "bg-green-100/50 text-green-700 dark:bg-green-900/20 dark:text-green-400",
                tool.status === 'failed' && "bg-red-100/50 text-red-700 dark:bg-red-900/20 dark:text-red-400",
                tool.status === 'running' && "bg-purple-100/50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400"
              )}
            >
              <Wrench className="h-2.5 w-2.5" />
              {tool.toolName}
            </span>
          ))}
        </div>
      )}

      {/* Agent's response text (intermediate, not final) */}
      {hasResponse && (
        <div className="text-sm text-muted-foreground leading-relaxed pl-2 border-l border-muted">
          {step.responseText}
        </div>
      )}

      {/* Handoff message */}
      {hasHandoff && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground/70 mt-1">
          <ArrowRight className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span className="italic">{step.handoffMessage}</span>
        </div>
      )}

      {/* Handoff context data */}
      {hasContext && (
        <div className="mt-1.5 p-2 bg-muted/30 rounded text-xs font-mono overflow-x-auto">
          <pre className="whitespace-pre-wrap break-words">
            {JSON.stringify(step.handoffContext, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default SwarmProgress;
