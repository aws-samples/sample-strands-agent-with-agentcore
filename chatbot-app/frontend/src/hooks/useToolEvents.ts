'use client';

import { useSyncExternalStore, useEffect, useRef } from 'react';
import { ToolProgressState } from '@/types/events';
import { getApiUrl } from '@/config/environment';

interface ToolProgressEvent {
  type: 'tool_progress';
  toolName: string;
  sessionId: string;
  step: string;
  message: string;
  progress?: number;
  timestamp: string;
  metadata?: Record<string, any>;
}

interface ToolAnalysisEvent {
  type: 'tool_analysis_start' | 'tool_analysis_stream' | 'tool_analysis_complete' | 'tool_analysis_error';
  sessionId: string;
  toolUseId: string;
  message?: string;
  data?: string;
  step: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

interface ToolChartEvent {
  type: 'tool_chart_created';
  sessionId: string;
  chartId: string;
  chartTitle: string;
  step: string;
  timestamp: string;
}

type ToolEvent = ToolProgressEvent | ToolAnalysisEvent | ToolChartEvent | {
  type: 'tools_connected' | 'keepalive';
  message?: string;
  timestamp: string;
};

interface ToolAnalysisState {
  toolUseId: string;
  events: ToolAnalysisEvent[];
  currentStep: string;
  isActive: boolean;
  lastUpdate: string;
  chartIds: string[];
}

interface UseToolEventsReturn {
  progressStates: ToolProgressState[];
  hasActiveProgress: boolean;
  clearProgress: () => void;
  analysisStates: ToolAnalysisState[];
  hasActiveAnalysis: boolean;
  clearAnalysis: () => void;
  clearAnalysisForSession: (sessionId: string) => void;
  clearOnNewTool: (toolUseId: string) => void;
  getAnalysisForSession: (sessionId: string) => ToolAnalysisState | null;
  isConnected: boolean;
  connectionError: string | null;
}

interface StoreSnapshot {
  progressStates: ToolProgressState[];
  analysisStates: ToolAnalysisState[];
  isConnected: boolean;
  connectionError: string | null;
  hasActiveProgress: boolean;
  hasActiveAnalysis: boolean;
}

class SessionEventSourceManager {
  private static eventSources = new Map<string, EventSource>();
  private static eventSourceStores = new Map<string, Set<ToolEventsStore>>();

  static getOrCreate(sessionId: string, store: ToolEventsStore): EventSource {
    const existing = this.eventSources.get(sessionId);
    if (existing && existing.readyState !== EventSource.CLOSED) {
      if (!this.eventSourceStores.has(sessionId)) {
        this.eventSourceStores.set(sessionId, new Set());
      }
      this.eventSourceStores.get(sessionId)!.add(store);
      return existing;
    }

    const eventSource = new EventSource(getApiUrl(`stream/tools?session_id=${encodeURIComponent(sessionId)}`));
    this.eventSources.set(sessionId, eventSource);
    
    if (!this.eventSourceStores.has(sessionId)) {
      this.eventSourceStores.set(sessionId, new Set());
    }
    this.eventSourceStores.get(sessionId)!.add(store);

    eventSource.onopen = () => {
      this.broadcastToStores(sessionId, 'onopen');
    };

    eventSource.onmessage = (event) => {
      this.broadcastToStores(sessionId, 'onmessage', event);
    };

    eventSource.onerror = (error) => {
      this.broadcastToStores(sessionId, 'onerror', error);
      if (eventSource.readyState === EventSource.CLOSED) {
        this.cleanup(sessionId);
      }
    };

    return eventSource;
  }

  static remove(sessionId: string, store: ToolEventsStore) {
    const stores = this.eventSourceStores.get(sessionId);
    if (stores) {
      stores.delete(store);
      if (stores.size === 0) {
        this.cleanup(sessionId);
      }
    }
  }

  private static cleanup(sessionId: string) {
    const eventSource = this.eventSources.get(sessionId);
    if (eventSource) {
      eventSource.close();
      this.eventSources.delete(sessionId);
    }
    this.eventSourceStores.delete(sessionId);
  }

  private static broadcastToStores(sessionId: string, eventType: string, eventData?: any) {
    const stores = this.eventSourceStores.get(sessionId);
    if (stores) {
      stores.forEach(store => {
        switch (eventType) {
          case 'onopen':
            store.handleOpen();
            break;
          case 'onmessage':
            store.handleMessage(eventData);
            break;
          case 'onerror':
            store.handleError(eventData);
            break;
        }
      });
    }
  }
}

class ToolEventsStore {
  private progressStates: ToolProgressState[] = [];
  private analysisStates: ToolAnalysisState[] = [];
  private isConnected: boolean = false;
  private connectionError: string | null = null;
  private listeners: Set<() => void> = new Set();
  private currentSessionId: string | undefined = undefined;
  private currentSnapshot: StoreSnapshot;
  private readonly serverSnapshot: StoreSnapshot = {
    progressStates: [],
    analysisStates: [],
    isConnected: false,
    connectionError: null,
    hasActiveProgress: false,
    hasActiveAnalysis: false
  };

  constructor(currentSessionId?: string) {
    this.currentSessionId = currentSessionId;
    this.currentSnapshot = {
      progressStates: this.progressStates,
      analysisStates: this.analysisStates,
      isConnected: this.isConnected,
      connectionError: this.connectionError,
      hasActiveProgress: false,
      hasActiveAnalysis: false
    };
    
    if (typeof window !== 'undefined' && currentSessionId) {
      this.connect();
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => {
    return this.currentSnapshot;
  };

  getServerSnapshot = () => {
    return this.serverSnapshot;
  };

  private updateSnapshot = () => {
    const hasActiveProgress = this.progressStates.some(p => p.isActive);
    const hasActiveAnalysis = this.analysisStates.some(a => a.isActive);
    
    this.currentSnapshot = {
      progressStates: this.progressStates,
      analysisStates: this.analysisStates,
      isConnected: this.isConnected,
      connectionError: this.connectionError,
      hasActiveProgress,
      hasActiveAnalysis
    };
    
    this.listeners.forEach(listener => listener());
  };

  clearProgress = () => {
    this.progressStates = [];
    this.updateSnapshot();
  };

  clearAnalysis = () => {
    this.analysisStates = [];
    this.updateSnapshot();
  };

  // SIMPLE SOLUTION: Clear all data when new tool starts
  clearOnNewTool = (newToolUseId: string) => {
    console.log(`🧹 CLEARING ALL DATA - New tool detected: ${newToolUseId}`);
    // Clear everything EXCEPT the new tool that's starting
    this.analysisStates = this.analysisStates.filter(state => state.toolUseId === newToolUseId);
    // Clear all inactive progress states (keep only active ones)
    this.progressStates = this.progressStates.filter(p => p.isActive);
    this.updateSnapshot(); // Immediate update
  };

  clearAnalysisForSession = (sessionId: string) => {
    // Note: This method clears by session but the analysis states are keyed by toolUseId
    // For session-based clearing, we need a different approach or this method should be renamed
    // For now, keeping existing behavior but this may need revision
    this.analysisStates = this.analysisStates.filter(state => state.toolUseId !== sessionId);
    this.updateSnapshot();
  };

  getAnalysisForSession = (sessionId: string): ToolAnalysisState | null => {
    // Note: This method should be renamed as it's looking for toolUseId, not sessionId
    return this.analysisStates.find(state => state.toolUseId === sessionId) || null;
  };

  getSessionId() {
    return this.currentSessionId;
  }

  private connect = () => {
    if (!this.currentSessionId) return;
    
    SessionEventSourceManager.getOrCreate(this.currentSessionId, this);
  };

  handleOpen = () => {
    this.isConnected = true;
    this.connectionError = null;
    this.updateSnapshot();
  };

  handleMessage = (event: MessageEvent) => {
    try {
      const data: ToolEvent = JSON.parse(event.data);

      if (data.type === 'tools_connected' || data.type === 'keepalive') {
        return;
      }

      // CRITICAL: Verify session ID matches current session
      // This is a safety check in case backend filtering fails or events leak
      if ('sessionId' in data && data.sessionId && this.currentSessionId) {
        if (data.sessionId !== this.currentSessionId) {
          console.warn(`⚠️ Received event for different session. Expected: ${this.currentSessionId}, Got: ${data.sessionId}`);
          return; // Ignore events from other sessions
        }
      }

      this.handleToolEvent(data);
    } catch (error) {
      console.error('Failed to parse tool event:', error);
    }
  };

  handleError = (error: Event) => {
    this.isConnected = false;
    this.connectionError = 'Connection lost';
    this.updateSnapshot();
  };

  private handleToolEvent = (data: ToolEvent) => {
    switch (data.type) {
      case 'tool_progress':
        this.handleProgressEvent(data as ToolProgressEvent);
        break;
      case 'tool_analysis_start':
      case 'tool_analysis_stream': 
      case 'tool_analysis_complete':
      case 'tool_analysis_error':
        this.handleAnalysisEvent(data as ToolAnalysisEvent);
        break;
    }
  };

  private handleProgressEvent = (event: ToolProgressEvent) => {
    const progressState: ToolProgressState = {
      context: event.toolName,
      executor: event.metadata?.executor || event.toolName,
      sessionId: event.sessionId,
      step: event.step,
      message: event.message,
      progress: event.progress,
      timestamp: event.timestamp,
      metadata: event.metadata || {},
      isActive: event.step !== 'completed' && event.step !== 'error'  // Inactive when done
    };

    // Remove old progress for the same tool
    const existingIndex = this.progressStates.findIndex(
      p => p.context === event.toolName && p.sessionId === event.sessionId
    );

    if (existingIndex !== -1) {
      // Update existing progress
      this.progressStates = [
        ...this.progressStates.slice(0, existingIndex),
        progressState,
        ...this.progressStates.slice(existingIndex + 1)
      ];
    } else {
      // Add new progress
      this.progressStates = [...this.progressStates, progressState];
    }

    // Auto-remove completed/error progress after delay
    if (!progressState.isActive) {
      setTimeout(() => {
        this.progressStates = this.progressStates.filter(
          p => !(p.context === event.toolName && p.sessionId === event.sessionId && !p.isActive)
        );
        this.updateSnapshot();
      }, 3000); // Remove after 3 seconds
    }

    this.updateSnapshot();
  };

  private handleAnalysisEvent = (event: ToolAnalysisEvent) => {
    let analysisState = this.analysisStates.find(state => state.toolUseId === event.toolUseId);
    
    if (!analysisState) {
      // NEW TOOL DETECTED - CLEAR ALL EXISTING DATA (SIMPLE SOLUTION)
      if (event.type === 'tool_analysis_start') {
        this.clearOnNewTool(event.toolUseId);
      }
      
      // New tool execution - create fresh state
      analysisState = {
        toolUseId: event.toolUseId,
        events: [event],
        currentStep: event.step,
        isActive: true,
        lastUpdate: event.timestamp,
        chartIds: []
      };
      this.analysisStates = [...this.analysisStates, analysisState];
    } else {
      // Check if this is a new tool execution with same toolUseId (shouldn't happen but safety check)
      if (event.type === 'tool_analysis_start') {
        analysisState = {
          toolUseId: event.toolUseId,
          events: [event],
          currentStep: event.step,
          isActive: true,
          lastUpdate: event.timestamp,
          chartIds: []
        };
        this.analysisStates = this.analysisStates.map(state => 
          state.toolUseId === event.toolUseId ? analysisState! : state
        );
      } else {
        // Update existing state
        const updatedState = {
          ...analysisState,
          events: [...analysisState.events, event],
          currentStep: event.step,
          isActive: event.type !== 'tool_analysis_complete' && event.type !== 'tool_analysis_error',
          lastUpdate: event.timestamp
        };
        
        this.analysisStates = this.analysisStates.map(state => 
          state.toolUseId === event.toolUseId ? updatedState : state
        );
      }
    }
    
    this.updateSnapshot();
  };

  destroy = () => {
    if (this.currentSessionId) {
      SessionEventSourceManager.remove(this.currentSessionId, this);
    }
    this.listeners.clear();
  };
}

export const useToolEvents = (backendUrl: string, currentSessionId?: string): UseToolEventsReturn => {
  const storeRef = useRef<ToolEventsStore | null>(null);

  if (!storeRef.current || storeRef.current.getSessionId() !== currentSessionId) {
    if (storeRef.current) {
      storeRef.current.destroy();
    }
    storeRef.current = new ToolEventsStore(currentSessionId);
  }
  useEffect(() => {
    return () => {
      if (storeRef.current) {
        storeRef.current.destroy();
        storeRef.current = null;
      }
    };
  }, []);

  const snapshot = useSyncExternalStore(
    storeRef.current.subscribe,
    storeRef.current.getSnapshot,
    storeRef.current.getServerSnapshot
  );

  return {
    progressStates: snapshot.progressStates,
    hasActiveProgress: snapshot.hasActiveProgress,
    clearProgress: storeRef.current.clearProgress,
    analysisStates: snapshot.analysisStates,
    hasActiveAnalysis: snapshot.hasActiveAnalysis,
    clearAnalysis: storeRef.current.clearAnalysis,
    clearAnalysisForSession: storeRef.current.clearAnalysisForSession,
    clearOnNewTool: storeRef.current.clearOnNewTool, // NEW: Clear all data when new tool starts
    getAnalysisForSession: storeRef.current.getAnalysisForSession,
    isConnected: snapshot.isConnected,
    connectionError: snapshot.connectionError
  };
};
