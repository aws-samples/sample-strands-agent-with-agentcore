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
  node_id?: string;  // Swarm mode: which agent is responding
}

// Text event (used by Swarm mode streaming)
export interface TextEvent {
  type: 'text';
  content: string;
  node_id?: string;  // Swarm mode: which agent is sending text
}

// Stream lifecycle events
export interface StartEvent {
  type: 'start';
}

export interface EndEvent {
  type: 'end';
}

export interface ToolUseEvent {
  type: 'tool_use';
  toolUseId: string;
  name: string;
  input: Record<string, any>;
  node_id?: string;  // Swarm mode: which agent is using the tool
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
  node_id?: string;  // Swarm mode: which agent produced the result
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

export interface WarningEvent {
  type: 'warning';
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

export interface CodeStepEvent {
  type: 'code_step';
  stepNumber: number;
  content: string;
}

export interface CodeTodoUpdateEvent {
  type: 'code_todo_update';
  todos: Array<{ id: string; content: string; status: string; priority?: string }>;
}

export interface CodeResultMetaEvent {
  type: 'code_result_meta';
  files_changed: string[];
  todos: any[];
  steps: number;
  status: string;
}

export interface ResearchProgressEvent {
  type: 'research_progress';
  content: string;
  stepNumber: number;
}

// MCP Elicitation Events (OAuth consent via elicit_url protocol)
export interface OAuthElicitationEvent {
  type: 'oauth_elicitation';
  authUrl: string;
  message: string;
  elicitationId: string;
}

// Swarm Mode Events (Multi-Agent Orchestration)
export type SwarmState = 'idle' | 'running' | 'completed' | 'failed';

export interface SwarmNodeStartEvent {
  type: 'swarm_node_start';
  node_id: string;
  node_description: string;
}

export interface SwarmNodeStopEvent {
  type: 'swarm_node_stop';
  node_id: string;
  status: string;  // "completed" | "failed" | "interrupted"
}

export interface SwarmHandoffEvent {
  type: 'swarm_handoff';
  from_node: string;
  to_node: string;
  message?: string;
  context?: Record<string, any>;  // shared_context data from the handing-off agent
}

export interface SwarmCompleteEvent {
  type: 'swarm_complete';
  total_nodes: number;
  node_history: string[];
  status: string;
  // Fallback response when last agent is not responder
  final_response?: string;
  final_node_id?: string;
  // Shared context from all agents (for history display)
  shared_context?: Record<string, any>;
}

// Swarm agent execution step (for expanded view)
export interface SwarmAgentStep {
  nodeId: string;
  displayName: string;
  description?: string;
  startTime: number;
  endTime?: number;
  toolCalls?: Array<{
    toolName: string;
    status: 'running' | 'completed' | 'failed';
    toolUseId?: string;  // For matching with tool results
  }>;
  status: 'running' | 'completed' | 'failed';
  responseText?: string;   // Final response text
  reasoningText?: string;  // Intermediate reasoning/thinking
  handoffMessage?: string; // Message passed to next agent via handoff
  handoffContext?: Record<string, any>; // Actual data passed via handoff context
}

// Swarm progress state for UI
export interface SwarmProgress {
  isActive: boolean;
  currentNode: string;
  currentNodeDescription: string;
  nodeHistory: string[];
  status: SwarmState;
  // For collapsible expanded view
  currentAction?: string;  // Current tool or handoff being executed
  agentSteps?: SwarmAgentStep[];  // Detailed steps for expanded view
}

// Agent name to display name mapping
export const SWARM_AGENT_DISPLAY_NAMES: Record<string, string> = {
  coordinator: 'Coordinator',
  web_researcher: 'Web Researcher',
  academic_researcher: 'Academic Researcher',
  word_agent: 'Word',
  excel_agent: 'Excel',
  powerpoint_agent: 'PowerPoint',
  data_analyst: 'Analyst',
  browser_agent: 'Browser',
  weather_agent: 'Weather',
  finance_agent: 'Finance',
  maps_agent: 'Maps',
  responder: 'Responder',
};

export type StreamEvent =
  | ReasoningEvent
  | ResponseEvent
  | TextEvent
  | StartEvent
  | EndEvent
  | ToolUseEvent
  | ToolResultEvent
  | InitEvent
  | ThinkingEvent
  | CompleteEvent
  | ErrorEvent
  | WarningEvent
  | InterruptEvent
  | ProgressEvent
  | MetadataEvent
  | BrowserProgressEvent
  | ResearchProgressEvent
  | CodeStepEvent
  | CodeTodoUpdateEvent
  | CodeResultMetaEvent
  | OAuthElicitationEvent
  | SwarmNodeStartEvent
  | SwarmNodeStopEvent
  | SwarmHandoffEvent
  | SwarmCompleteEvent;

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

// OAuth authorization pending state
export interface PendingOAuthState {
  toolUseId?: string;
  toolName?: string;
  authUrl: string;
  serviceName: string;
  popupOpened: boolean;
  elicitationId?: string;
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
  swarmProgress?: SwarmProgress;
  pendingOAuth?: PendingOAuthState | null;
}

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'responding'
  | 'researching'
  | 'browser_automation'
  | 'stopping'
  | 'swarm'
  // Voice mode states
  | 'voice_connecting'
  | 'voice_listening'
  | 'voice_processing'
  | 'voice_speaking';

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

// All valid event types (single source of truth)
// Used by useChatAPI whitelist and sseParser validation
export const STREAM_EVENT_TYPES = [
  // Core events
  'reasoning', 'response', 'text', 'start', 'end',
  // Tool events
  'tool_use', 'tool_result', 'tool_progress',
  // Lifecycle events
  'init', 'thinking', 'complete', 'error', 'warning',
  // Special events
  'interrupt', 'progress', 'metadata',
  // Progress events
  'browser_progress', 'research_progress',
  // Code agent events
  'code_step', 'code_todo_update', 'code_result_meta',
  // Elicitation events
  'oauth_elicitation',
  // Swarm events
  'swarm_node_start', 'swarm_node_stop', 'swarm_handoff', 'swarm_complete',
] as const;

export type StreamEventType = typeof STREAM_EVENT_TYPES[number];
