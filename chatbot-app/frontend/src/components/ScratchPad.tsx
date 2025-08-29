'use client';

import React, { useState } from 'react';
import { AlertCircle, Activity, X, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToolProgressState } from '@/types/events';

interface ScratchPadProps {
  progressStates: ToolProgressState[];
  isVisible: boolean;
  connectionError: string | null;
  onClose?: () => void;
}

export const ScratchPad: React.FC<ScratchPadProps> = ({
  progressStates,
  isVisible,
  connectionError,
  onClose
}) => {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());


  const toggleGroup = (key: string) => {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(key)) {
      newCollapsed.delete(key);
    } else {
      newCollapsed.add(key);
    }
    setCollapsedGroups(newCollapsed);
  };
  
  const getStepIcon = (step: string, isLatest: boolean = false) => {
    if (step === 'error') {
      return (
        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></div>
      );
    }
    if (step === 'completed') {
      return (
        <div className={`w-1.5 h-1.5 rounded-full bg-green-500 ${isLatest ? 'animate-ping' : ''}`}></div>
      );
    }
    return (
      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
    );
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  const getContextDisplayName = (context: string) => {
    // Convert underscores/hyphens to spaces and capitalize first letter of each word
    return context.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getExecutorDisplayName = (executor: string) => {
    // Map executor names to more readable display names
    const executorNames: Record<string, string> = {
      'get-current-weather': 'Weather API',
      'weather-analyzer': 'Data Analyzer', 
      'create-visualization': 'Chart Generator',
      'calculator': 'Calculator',
      'http_request': 'HTTP Client',
      'code_interpreter': 'Code Runner',
      'analysis_coordinator': 'Analysis Coordinator',
      'data_processor': 'Data Processor',
      'analysis_engine': 'Analysis Engine',
      'analyze_spending_trends': 'Trends Analysis',
      'analyze_category_breakdown': 'Category Analysis', 
      'analyze_spending_behavior': 'Behavior Analysis'
    };
    return executorNames[executor] || executor;
  };

  return (
    <div className={`
      fixed top-0 right-0 h-full w-96 bg-sidebar-background border-l border-sidebar-border
      transform transition-transform duration-300 ease-in-out z-50 shadow-2xl
      ${isVisible ? 'translate-x-0' : 'translate-x-full'}
    `}>
      {/* Close Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose && onClose();
        }}
        className="absolute top-4 right-4 h-8 w-8 p-0 hover:bg-sidebar-accent z-40"
      >
        <X className="h-4 w-4 text-sidebar-foreground" />
      </Button>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 pt-20">
        {/* Progress Section */}
        {progressStates.length > 0 && (
          <div className="space-y-6">
            {/* Group by context first, then by executor/session */}
            {Object.entries(
              progressStates.reduce((contextGroups, progress) => {
                const contextKey = progress.context;
                if (!contextGroups[contextKey]) {
                  contextGroups[contextKey] = {
                    context: progress.context,
                    executorSessions: {}
                  };
                }
                
                const executorSessionKey = `${progress.executor}-${progress.sessionId}`;
                if (!contextGroups[contextKey].executorSessions[executorSessionKey]) {
                  contextGroups[contextKey].executorSessions[executorSessionKey] = {
                    executor: progress.executor,
                    sessionId: progress.sessionId,
                    steps: []
                  };
                }
                
                contextGroups[contextKey].executorSessions[executorSessionKey].steps.push(progress);
                return contextGroups;
              }, {} as Record<string, { context: string; executorSessions: Record<string, { executor: string; sessionId: string; steps: typeof progressStates }> }>)
            ).map(([contextKey, contextGroup]) => (
              <div key={contextKey} className="space-y-4">
                {/* Context Header - Collapsible */}
                <button
                  onClick={() => toggleGroup(contextKey)}
                  className="flex items-center gap-2 pb-2 border-b border-sidebar-border w-full text-left hover:bg-sidebar-accent rounded px-1 -mx-1 transition-colors"
                >
                  <div className="flex-shrink-0">
                    {collapsedGroups.has(contextKey) ? (
                      <ChevronRight className="w-3 h-3 text-sidebar-foreground" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-sidebar-foreground" />
                    )}
                  </div>
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0"></div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-sidebar-foreground truncate">
                      {getContextDisplayName(contextGroup.context)}
                    </h3>
                  </div>
                </button>

                {/* Executor Sessions - Collapsible */}
                {!collapsedGroups.has(contextKey) && (
                  <div className="ml-4 space-y-3">
                    {Object.entries(contextGroup.executorSessions).map(([executorSessionKey, executorSession]) => (
                      <div key={executorSessionKey} className="space-y-2">
                        {/* Executor/Session Header */}
                        <div className="flex items-center gap-2 text-xs text-sidebar-foreground">
                          <div className="w-1 h-1 rounded-full bg-sidebar-foreground opacity-60"></div>
                          <span className="font-medium">
                            {getExecutorDisplayName(executorSession.executor)} #{executorSession.sessionId.split('_').pop()?.slice(0, 4)}
                          </span>
                        </div>
                        
                        {/* Steps List */}
                        <div className="space-y-1 ml-3">
                          {executorSession.steps.map((progress, index) => {
                            const isLatest = index === executorSession.steps.length - 1;
                            // Use template's key generation strategy for uniqueness
                            const uniqueKey = `${progress.sessionId}-${progress.step}-${progress.timestamp}-${index}`;
                            
                            return (
                              <div 
                                key={uniqueKey}
                                className={`
                                  flex items-center gap-2 py-1 group rounded px-1 -mx-1 
                                  transition-colors duration-200 ease-in-out hover:bg-sidebar-accent
                                  ${isLatest ? 'animate-in slide-in-from-left-2 duration-300' : ''}
                                `}
                                style={{
                                  willChange: isLatest ? 'transform' : 'auto'
                                }}
                              >
                                <div className="flex-shrink-0">
                                  {getStepIcon(progress.step, isLatest)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={`
                                    text-xs leading-relaxed truncate transition-colors duration-150
                                    ${isLatest ? 'text-sidebar-foreground font-medium' : 'text-sidebar-foreground opacity-80'}
                                  `}>
                                    {progress.message}
                                  </p>
                                </div>
                                <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                                  <span className="text-xs text-sidebar-foreground opacity-60">
                                    {formatTimestamp(progress.timestamp)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {progressStates.length === 0 && (
          <div className="text-center py-8 text-sidebar-foreground">
            <Activity className="w-8 h-8 mx-auto mb-3 text-sidebar-foreground opacity-50" />
            <p className="text-sm">No active operations</p>
            <p className="text-xs text-sidebar-foreground opacity-60 mt-1">
              Tool progress will appear here
            </p>
          </div>
        )}

        {/* Connection Error */}
        {connectionError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-xs text-red-700">
                {connectionError}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
