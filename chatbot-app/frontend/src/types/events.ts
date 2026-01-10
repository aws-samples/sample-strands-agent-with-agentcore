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

export interface ResearchProgressEvent {
  type: 'research_progress';
  content: string;
  stepNumber: number;
}

// Autopilot Mode Events (Mission Control Orchestration)
export type AutopilotState = 'off' | 'init' | 'executing' | 'finishing';

export interface MissionProgressEvent {
  type: 'mission_progress';
  step: number;
  directive_prompt: string;
  active_tools: string[];
}

export interface MissionCompleteEvent {
  type: 'mission_complete';
  total_steps: number;
}

// Autopilot mode flag for tracking multi-step missions as single turn
export interface AutopilotModeState {
  isActive: boolean;
  turnMessageId: string | null;  // The single message ID for entire autopilot turn
}

// Legacy autopilot events (keep for compatibility)
export interface AutopilotProgressEvent {
  type: 'autopilot_progress';
  missionId: string;
  state: AutopilotState;
  step: number;
  currentTask: string;
  activeTools: string[];
}

export interface AutopilotCompleteEvent {
  type: 'autopilot_complete';
  missionId: string;
  totalSteps: number;
  summary: string;
}

export interface AutopilotErrorEvent {
  type: 'autopilot_error';
  missionId: string;
  step: number;
  error: string;
  recoverable: boolean;
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
  | BrowserProgressEvent
  | ResearchProgressEvent
  | MissionProgressEvent
  | MissionCompleteEvent
  | AutopilotProgressEvent
  | AutopilotCompleteEvent
  | AutopilotErrorEvent;

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

export interface AutopilotProgress {
  missionId: string;
  state: AutopilotState;
  step: number;
  currentTask: string;
  activeTools: string[];
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
  researchProgress?: {
    stepNumber: number;
    content: string;
  };
  interrupt: InterruptState | null;
  autopilotProgress?: AutopilotProgress;
}

export type AgentStatus = 'idle' | 'thinking' | 'responding' | 'researching' | 'browser_automation' | 'stopping' | 'autopilot';

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
