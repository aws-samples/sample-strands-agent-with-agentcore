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

export interface WorkspaceFile {
  filename: string;
  size_kb: string;
  last_modified: string;
  s3_key: string;
  tool_type: string;
}

export interface ToolResultEvent {
  type: 'tool_result';
  toolUseId: string;
  result: string;
  status?: string;
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
  documents?: Array<{
    filename: string;
    tool_type: string;
  }>;
  usage?: TokenUsage;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
}

export interface InterruptEvent {
  type: 'interrupt';
  interrupts: Array<{
    id: string;
    name: string;
    reason?: {
      tool_name?: string;
      plan?: string;
      plan_preview?: string;
    };
  }>;
}

export interface ProgressEvent {
  type: 'progress';
  message?: string;
  data?: Record<string, any>;
}

export interface MetadataEvent {
  type: 'metadata';
  metadata?: {
    browserSessionId?: string;
    browserId?: string;
    [key: string]: any;
  };
}

export interface BrowserProgressEvent {
  type: 'browser_progress';
  content: string;
  stepNumber: number;
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
  | InterruptEvent
  | ProgressEvent
  | MetadataEvent
  | BrowserProgressEvent;

// Chat state interfaces
export interface ReasoningState {
  text: string;
  isActive: boolean;
}

export interface StreamingState {
  text: string;
  id: number;
}

export interface InterruptState {
  interrupts: Array<{
    id: string;
    name: string;
    reason?: {
      tool_name?: string;
      plan?: string;
      plan_preview?: string;
    };
  }>;
}

export interface ChatSessionState {
  reasoning: ReasoningState | null;
  streaming: StreamingState | null;
  toolExecutions: ToolExecution[];
  browserSession: {
    sessionId: string | null;
    browserId: string | null;
  } | null;
  browserProgress?: Array<{
    stepNumber: number;
    content: string;
  }>;
  interrupt: InterruptState | null;
}

export type AgentStatus = 'idle' | 'thinking' | 'responding' | 'researching' | 'browser_automation' | 'stopping';

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
