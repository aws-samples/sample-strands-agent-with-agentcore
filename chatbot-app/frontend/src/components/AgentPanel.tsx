import { AnimatePresence, motion } from 'framer-motion';
import { memo, useCallback, useMemo, useEffect, useState } from 'react';
import { useWindowSize } from '../hooks/useWindowSize';
import { useAgentAnalysis } from '@/hooks/useAgentAnalysis';
import { useToolEvents } from '@/hooks/useToolEvents';
import { API_CONFIG } from '@/config/api';
import { Markdown } from '@/components/ui/Markdown';
import { ChartRenderer } from '@/components/ChartRenderer';
import { ToolExecutionContainer } from '@/components/chat/ToolExecutionContainer';
import { X, Loader2, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToolExecution } from '@/types/chat';

interface AgentPanelProps {
  analysisStates: any[];
  progressStates: any[];
  isConnected: boolean;
  sessionId?: string;
  clearAnalysisForSession?: (sessionId: string) => void;
  clearOnNewTool?: (toolUseId: string) => void;
}

function PureAgentPanel({ analysisStates, progressStates, isConnected, sessionId, clearAnalysisForSession, clearOnNewTool }: AgentPanelProps) {
  const { agentAnalysis, setAgentAnalysis, resetAnalysisForNewSession, clearContentOnly } = useAgentAnalysis();
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const isMobile = windowWidth ? windowWidth < 768 : false;

  // Initialize panel on first load
  useEffect(() => {
    const isPageRefresh = typeof window !== 'undefined' && 
      (window.performance?.navigation?.type === 1 || 
       (window.performance?.getEntriesByType('navigation')?.[0] as any)?.type === 'reload');
    
    if (isPageRefresh) {
      resetAnalysisForNewSession();
      if (clearAnalysisForSession && sessionId) {
        clearAnalysisForSession(sessionId);
      }
    }
  }, []); // Run only once on mount

  // Handle session changes - clear content when sessionId changes
  useEffect(() => {
    // Clear agent analysis when session changes and reset window state
    window.__lastFinalResponseState = undefined;
    setAgentAnalysis(prev => ({
      ...prev,
      id: 'init',
      content: '',
      status: 'streaming', // Default to loading state
      chartIds: [],
    }));
  }, [sessionId, setAgentAnalysis]);

  // Handle analysis states changes
  useEffect(() => {
    if (!analysisStates.length) {
      return;
    }

    // Find the most recent analysis session
    const latestSession = analysisStates
      .sort((a, b) => new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime())[0];

    if (!latestSession) {
      return;
    }

    // DIRECT SOLUTION: Clear content when switching to different session/tool
    // If user clicked on a panel that's still processing and session ID / tool use ID are different,
    // always completely clear the AgentPanel content
    const isCurrentSession = agentAnalysis.id === latestSession.toolUseId;
    const isInitialState = !agentAnalysis.id || agentAnalysis.id === 'init';
    const isDifferentSession = agentAnalysis.id && agentAnalysis.id !== 'init' && !isCurrentSession;
    const isStreamingSession = latestSession.toolUseId && latestSession.isActive;
    
    // Clear content immediately when switching to different tool/session
    if (isDifferentSession && isStreamingSession) {
      console.log(`🧹 Clearing content - switching from ${agentAnalysis.id} to ${latestSession.toolUseId}`);
      setAgentAnalysis(prev => ({
        ...prev,
        id: latestSession.toolUseId,
        content: '',
        status: 'streaming',
        chartIds: [],
      }));
      return;
    }

    // Check if we're in "View Analysis" mode (viewing completed analysis)
    const isViewAnalysisMode = agentAnalysis.id && agentAnalysis.id.startsWith('tooluse_') && agentAnalysis.status === 'idle';
    
    // Update analysis state if:
    // 1. This is the current session we're tracking (but NOT in View Analysis mode), OR
    // 2. We're in initial state and this is a streaming session
    // Note: Do NOT override View Analysis mode - let users view specific analysis results
    if ((isCurrentSession && !isViewAnalysisMode) || (isInitialState && isStreamingSession)) {
      const streamEvents = latestSession.events.filter((event: any) => 
        event.type === 'tool_analysis_stream' && event.data
      );
      const accumulatedContent = streamEvents.map((event: any) => event.data).join('');
      const completionEvent = latestSession.events.find((event: any) => event.type === 'tool_analysis_complete');
      const finalContent = completionEvent?.data || accumulatedContent;

      // Reset window state for clean start when switching tools
      if (agentAnalysis.id !== latestSession.toolUseId) {
        window.__lastFinalResponseState = undefined;
        window.__lastCompletionState = undefined;
      }

      // Update analysis state with content
      setAgentAnalysis(prev => ({
        ...prev,
        id: latestSession.toolUseId,
        title: 'Agent Analysis',
        content: finalContent || '',
        status: latestSession.isActive ? 'streaming' : 'idle',
        chartIds: latestSession.chartIds || [],
      }));
    }
  }, [analysisStates, agentAnalysis.id, setAgentAnalysis]);

  const handleClose = useCallback(() => {
    setAgentAnalysis((current) => ({
      ...current,
      isVisible: false,
      userClosedToolIds: current.id ? [...current.userClosedToolIds, current.id] : current.userClosedToolIds,
    }));
  }, [setAgentAnalysis]);

  // Get current analysis state from stream
  const currentAnalysisState = useMemo(() => {
    if (analysisStates.length === 0) return null;
    // Get the most recent analysis state
    const latest = analysisStates[analysisStates.length - 1];
    return latest;
  }, [analysisStates]);

  // Determine if we should show content or loading
  const shouldShowContent = useMemo(() => {
    // Check if we have any analysis events (start, stream, or complete)
    if (currentAnalysisState && currentAnalysisState.events.length > 0) {
      // Check for completion event first - if analysis is complete, show content immediately
      const completionEvent = currentAnalysisState.events.find((event: any) => 
        event.type === 'tool_analysis_complete'
      );
      
      if (completionEvent) {
        return true;
      }
      
      // Check for any stream events with data
      const streamEvents = currentAnalysisState.events.filter((event: any) => 
        event.type === 'tool_analysis_stream' && event.data
      );
      
      // If we have stream events, check for <final_response>
      if (streamEvents.length > 0) {
        const accumulatedStreamData = streamEvents.map((event: any) => event.data).join('');
        const hasFinalResponseStarted = accumulatedStreamData.includes('<final_response>');
        
        
        return hasFinalResponseStarted;
      }
    }
    
    // Fallback: show content if we have stored content and analysis is not active
    return agentAnalysis.content && agentAnalysis.content.trim() && agentAnalysis.status === 'idle';
  }, [currentAnalysisState?.events, currentAnalysisState?.events?.length, agentAnalysis.content, agentAnalysis.status]);

  // Accumulate all analysis content
  const accumulatedContent = useMemo(() => {
    if (!shouldShowContent) {
      return '';
    }

    let content = '';
    
    // First, try to get content from stream events
    if (currentAnalysisState && currentAnalysisState.events.length > 0) {
      // Filter out reasoning events and accumulate all data
      const progressEvents = currentAnalysisState.events
        .filter((event: any) => 
          event.type === 'tool_analysis_stream' && 
          event.data
        );
      content = progressEvents.map((event: any) => event.data).join('');
    }
    
    // Fallback to stored content if no stream content
    if (!content && agentAnalysis.content) {
      content = agentAnalysis.content;
    }

    if (!content) {
      return '';
    }

    // Apply XML filtering for final_response content
    let filteredContent = content;
    
    // Only apply filtering if analysis is complete (not streaming)
    const isStreamingComplete = currentAnalysisState && !currentAnalysisState.isActive;
    
    if (isStreamingComplete) {
      // Analysis complete - apply final_response filtering
      const finalResponseMatch = content.match(/<final_response[^>]*>([\s\S]*?)<\/final_response>/gi);
      if (finalResponseMatch) {
        // Complete final_response found - extract the content
        filteredContent = content.replace(/<final_response[^>]*>([\s\S]*?)<\/final_response>/gi, '$1');
      }
    } else {
      // During streaming - show all content without filtering
      // This prevents issues with chunked final_response tags
      filteredContent = content;
    }

    // Extract content starting from the first markdown header
    const headerMatch = filteredContent.match(/(^|\n)(# [\s\S]*)/);
    return headerMatch ? headerMatch[2] : filteredContent;
  }, [shouldShowContent, agentAnalysis.content, currentAnalysisState]);

  if (!agentAnalysis.isVisible) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        data-testid="agent-panel"
        className="flex flex-row h-dvh w-dvw fixed top-0 left-0 z-50 bg-transparent"
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { delay: 0.4 } }}
      >
        {/* Background overlay for desktop */}
        {!isMobile && (
          <motion.div
            className="fixed bg-background h-dvh"
            initial={{
              width: windowWidth,
              right: 0,
            }}
            animate={{ width: windowWidth, right: 0 }}
            exit={{
              width: windowWidth,
              right: 0,
            }}
          />
        )}

        {/* Chat panel for desktop */}
        {!isMobile && (
          <motion.div
            className="relative w-[400px] bg-sidebar-background h-dvh shrink-0"
            initial={{ opacity: 0, x: 10, scale: 1 }}
            animate={{
              opacity: 1,
              x: 0,
              scale: 1,
              transition: {
                delay: 0.2,
                type: 'spring',
                stiffness: 200,
                damping: 30,
              },
            }}
            exit={{
              opacity: 0,
              x: 0,
              scale: 1,
              transition: { duration: 0 },
            }}
          >
            <div className="flex flex-col h-full justify-center items-center p-8">
              <div className="text-center">
                <Brain className="h-16 w-16 text-blue-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2 text-sidebar-foreground">Agent Analysis</h3>
                <p className="text-sm text-sidebar-foreground opacity-70">
                  Your comprehensive analysis is being generated in the panel on the right.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Main analysis panel */}
        <motion.div
          className="fixed bg-sidebar-background h-dvh flex flex-col overflow-hidden md:border-l border-sidebar-border"
          initial={{
            opacity: 1,
            x: agentAnalysis.boundingBox.left,
            y: agentAnalysis.boundingBox.top,
            height: agentAnalysis.boundingBox.height,
            width: agentAnalysis.boundingBox.width,
            borderRadius: 50,
          }}
          animate={
            isMobile
              ? {
                  opacity: 1,
                  x: 0,
                  y: 0,
                  height: windowHeight,
                  width: windowWidth ? windowWidth : 'calc(100dvw)',
                  borderRadius: 0,
                  transition: {
                    delay: 0,
                    type: 'spring',
                    stiffness: 200,
                    damping: 30,
                    duration: 5000,
                  },
                }
              : {
                  opacity: 1,
                  x: 400,
                  y: 0,
                  height: windowHeight,
                  width: windowWidth
                    ? windowWidth - 400
                    : 'calc(100dvw-400px)',
                  borderRadius: 0,
                  transition: {
                    delay: 0,
                    type: 'spring',
                    stiffness: 200,
                    damping: 30,
                    duration: 5000,
                  },
                }
          }
          exit={{
            opacity: 0,
            scale: 0.5,
            transition: {
              delay: 0.1,
              type: 'spring',
              stiffness: 600,
              damping: 30,
            },
          }}
        >
          {/* Header */}
          <div className="p-4 flex flex-row justify-between items-start border-b border-sidebar-border">
            <div className="flex flex-row gap-4 items-start">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>

              <div className="flex flex-col">
                <div className="font-medium flex items-center gap-2 text-sidebar-foreground">
                  <Brain className="h-4 w-4 text-blue-500" />
                  {agentAnalysis.title || 'Agent Analysis'}
                </div>

                {agentAnalysis.status === 'streaming' && agentAnalysis.currentStep && (
                  <div className="text-sm text-sidebar-foreground opacity-70 flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {agentAnalysis.stepDescription || `Processing ${agentAnalysis.currentStep}...`}
                  </div>
                )}

                {agentAnalysis.status === 'idle' && (
                  <div className="text-sm text-sidebar-foreground opacity-70">
                    Analysis complete
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {shouldShowContent && accumulatedContent ? (
              <div className="space-y-6">
                {/* Accumulated Analysis Content - AssistantTurn style */}
                <div className="max-w-none prose prose-slate dark:prose-invert">
                  <Markdown size="base" sessionId={sessionId} toolUseId={currentAnalysisState?.toolUseId || agentAnalysis.id}>{accumulatedContent}</Markdown>
                </div>
                
                {/* Charts */}
                {((agentAnalysis.chartIds && agentAnalysis.chartIds.length > 0) || 
                  (currentAnalysisState && currentAnalysisState.chartIds && currentAnalysisState.chartIds.length > 0)) && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-sidebar-foreground">Visual Analysis</h3>
                    {/* Use stream chart IDs first, fallback to stored chart IDs */}
                    {(currentAnalysisState?.chartIds || agentAnalysis.chartIds || []).map((chartId: string) => (
                      <div key={chartId} className="border border-sidebar-border rounded-lg p-4 bg-sidebar-background">
                        <ChartRenderer chartId={chartId} sessionId={sessionId} toolUseId={currentAnalysisState?.toolUseId || agentAnalysis.id} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500 mb-4" />
                <h3 className="text-lg font-semibold mb-2 text-sidebar-foreground">Generating Analysis</h3>
                <p className="text-sidebar-foreground opacity-70 mb-4">
                  Please wait while the analysis is being generated...
                </p>
                {!isConnected && !analysisStates.length && !progressStates.length && (
                  <p className="text-sm text-red-500">
                    Connection to analysis stream lost. Attempting to reconnect...
                  </p>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export const AgentPanel = memo(PureAgentPanel);

export const AgentPanelWithStream = memo(({ sessionId }: { sessionId?: string }) => {
  const { analysisStates, progressStates, isConnected, clearAnalysisForSession, clearOnNewTool } = useToolEvents('', sessionId);
  
  return <AgentPanel 
    analysisStates={analysisStates} 
    progressStates={progressStates} 
    isConnected={isConnected} 
    sessionId={sessionId}
    clearAnalysisForSession={clearAnalysisForSession}
    clearOnNewTool={clearOnNewTool}
  />;
});

AgentPanelWithStream.displayName = 'AgentPanelWithStream';
