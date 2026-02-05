'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';
import { ChatSession } from '@/hooks/useChatSessions';

interface ChatSessionListProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  isLoading: boolean;
  onLoadSession?: (sessionId: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
}

export function ChatSessionList({
  sessions,
  currentSessionId,
  isLoading,
  onLoadSession,
  onDeleteSession,
}: ChatSessionListProps) {
  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await onDeleteSession(sessionId);
    } catch (error) {
      alert('Failed to delete session. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div className="px-2">
        <div className="text-center py-8 text-sidebar-foreground/60">
          <p className="text-[15px]">Loading...</p>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="px-2">
        <div className="py-4 text-sidebar-foreground/50">
          <p className="text-[15px] px-2">No conversations yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-2 space-y-1">
      {sessions.map((session) => {
        const isCurrentSession = session.sessionId === currentSessionId;

        return (
          <div
            key={session.sessionId}
            className={`group/session flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-sidebar-accent transition-colors cursor-pointer ${
              isCurrentSession ? 'bg-sidebar-accent' : ''
            }`}
            onClick={() => {
              if (onLoadSession) {
                onLoadSession(session.sessionId);
              }
            }}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-[15px] text-sidebar-foreground truncate">
                {session.title}
              </span>
            </div>
            <button
              onClick={(e) => handleDeleteSession(session.sessionId, e)}
              className="opacity-0 group-hover/session:opacity-100 transition-opacity p-1.5 rounded hover:bg-destructive/10 text-sidebar-foreground/40 hover:text-destructive flex-shrink-0"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
