import { useState, useCallback, useEffect } from 'react';
import { apiGet, apiDelete } from '@/lib/api-client';

export interface ChatSession {
  sessionId: string;
  title: string;
  lastMessageAt: string;
  messageCount: number;
  starred?: boolean;
  status: string;
  createdAt: string;
  tags?: string[];
}

interface UseChatSessionsProps {
  sessionId: string | null;
  onNewChat: () => void;
}

export function useChatSessions({ sessionId, onNewChat }: UseChatSessionsProps) {
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // Load chat sessions
  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const data = await apiGet<{ success: boolean; sessions: ChatSession[] }>(
        'session/list?limit=20&status=active'
      );

      if (data.success && data.sessions) {
        setChatSessions(data.sessions);
      }
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  // Delete a session
  const deleteSession = useCallback(async (sessionIdToDelete: string) => {
    try {
      const data = await apiDelete<{ success: boolean; error?: string }>(
        `session/delete?session_id=${sessionIdToDelete}`,
        {
          headers: sessionId ? { 'X-Session-ID': sessionId } : {},
        }
      );

      if (data.success) {
        // Refresh session list
        await loadSessions();

        // If deleted session was the active one, start new chat
        if (sessionIdToDelete === sessionId) {
          onNewChat();
        }
      } else {
        throw new Error(data.error || 'Failed to delete session');
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      throw error;
    }
  }, [sessionId, loadSessions, onNewChat]);

  // Delete all sessions
  const deleteAllSessions = useCallback(async () => {
    try {
      // Get fresh list of sessions first
      const freshData = await apiGet<{ success: boolean; sessions: ChatSession[] }>(
        'session/list?limit=100&status=active',
        {
          headers: sessionId ? { 'X-Session-ID': sessionId } : {},
        }
      );

      if (!freshData.success || !freshData.sessions || freshData.sessions.length === 0) {
        setChatSessions([]);
        onNewChat();
        return;
      }

      // Delete each session sequentially
      for (const session of freshData.sessions) {
        try {
          await apiDelete<{ success: boolean; error?: string }>(
            `session/delete?session_id=${session.sessionId}`,
            {
              headers: sessionId ? { 'X-Session-ID': sessionId } : {},
            }
          );
        } catch (e) {
          console.error(`Failed to delete session ${session.sessionId}:`, e);
          // Continue deleting other sessions even if one fails
        }
      }

      // Clear local state immediately
      setChatSessions([]);

      // Start new chat
      onNewChat();
    } catch (error) {
      console.error('Failed to delete all sessions:', error);
      throw error;
    }
  }, [sessionId, onNewChat]);

  // Load sessions on mount and when sessionId changes
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Expose loadSessions globally for external refresh
  useEffect(() => {
    (window as any).__refreshSessionList = loadSessions;
    return () => {
      delete (window as any).__refreshSessionList;
    };
  }, [loadSessions]);

  return {
    chatSessions,
    isLoadingSessions,
    loadSessions,
    deleteSession,
    deleteAllSessions,
  };
}
