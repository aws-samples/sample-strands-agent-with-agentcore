// SDK-standard event types for improved type safety
import type { ToolExecution } from '@/types/chat';

export interface ReasoningEvent {
  type: 'reasoning';
  text: string;
  step: 'thinking';
}

export interface ResponseEvent {
  type: 'response';
  text: string;
  step: 'answering';
}

export interface ToolUseEvent {
  type: 'tool_use';
  toolUseId: string;
  name: string;
  input: Record<string, any>;
}

export interface ToolResultEvent {
  type: 'tool_result';
  toolUseId: string;
  result: string;
  images?: Array<{
    format: string;
    data: string;
  }>;
  metadata?: Record<string, any>;
}

export interface InitEvent {
  type: 'init';
  message: string;
}

export interface ThinkingEvent {
  type: 'thinking';
  message: string;
}

export interface CompleteEvent {
  type: 'complete';
  message: string;
  images?: Array<{
    format: string;
    data: string;
  }>;
  usage?: TokenUsage;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
}

export interface ToolProgressEvent {
  type: 'tool_progress';
  toolId: string;
  sessionId: string;
  step: string;
  message: string;
  progress?: number;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface SpendingAnalysisStartEvent {
  type: 'spending_analysis_start';
  message: string;
}

export interface SpendingAnalysisStepEvent {
  type: 'spending_analysis_step';
  step_name: string;
  step_description: string;
  status: string;
}

export interface SpendingAnalysisResultEvent {
  type: 'spending_analysis_result';
  step_name: string;
  result: string;
}

export interface SpendingAnalysisCompleteEvent {
  type: 'spending_analysis_complete';
  final_summary: string;
}

export interface SpendingAnalysisChartEvent {
  type: 'spending_analysis_chart';
  chart_id: string;
  step_name: string;
}

export interface SpendingAnalysisProgressEvent {
  type: 'spending_analysis_progress';
  data: string;
  session_id: string;
}

export type StreamEvent = 
  | ReasoningEvent 
  | ResponseEvent 
  | ToolUseEvent 
  | ToolResultEvent
  | InitEvent 
  | ThinkingEvent 
  | CompleteEvent 
  | ErrorEvent
  | ToolProgressEvent
  | SpendingAnalysisStartEvent
  | SpendingAnalysisStepEvent
  | SpendingAnalysisResultEvent
  | SpendingAnalysisCompleteEvent
  | SpendingAnalysisChartEvent
  | SpendingAnalysisProgressEvent;

// Chat state interfaces
export interface ReasoningState {
  text: string;
  isActive: boolean;
}

export interface StreamingState {
  text: string;
  id: number;
}

export interface ToolProgressState {
  context: string;
  executor: string;
  sessionId: string;
  step: string;
  message: string;
  progress?: number;
  timestamp: string;
  metadata: Record<string, any>;
  isActive: boolean;
}

export interface ChatSessionState {
  reasoning: ReasoningState | null;
  streaming: StreamingState | null;
  toolExecutions: ToolExecution[];
  toolProgress: ToolProgressState[];
  browserSession: {
    sessionId: string | null;
    browserId: string | null;
  } | null;
}

export type AgentStatus = 'idle' | 'thinking' | 'responding';

export interface LatencyMetrics {
  requestStartTime: number | null;
  timeToFirstToken: number | null;  // ms from request to first response
  endToEndLatency: number | null;   // ms from request to completion
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}

export interface ChatUIState {
  isConnected: boolean;
  isTyping: boolean;
  showProgressPanel: boolean;
  agentStatus: AgentStatus;
  latencyMetrics: LatencyMetrics;
}

// Re-export for convenience
export type { ToolExecution } from '@/types/chat';
