'use client';

import React, { useMemo } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { ChatSession } from '@/hooks/useChatSessions';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ChatSessionListProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  isLoading: boolean;
  isSearching?: boolean;
  onClearSearch?: () => void;
  onLoadSession?: (sessionId: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
}

interface DateGroup {
  label: string;
  sessions: ChatSession[];
}

function groupSessionsByDate(sessions: ChatSession[]): DateGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const groups: Record<string, ChatSession[]> = {
    Today: [],
    Yesterday: [],
    'Last 7 days': [],
    'Last 30 days': [],
    Older: [],
  };

  for (const session of sessions) {
    const date = new Date(
      session.lastActivityAt || session.lastMessageAt || session.createdAt,
    );
    if (date >= today) {
      groups['Today'].push(session);
    } else if (date >= yesterday) {
      groups['Yesterday'].push(session);
    } else if (date >= weekAgo) {
      groups['Last 7 days'].push(session);
    } else if (date >= monthAgo) {
      groups['Last 30 days'].push(session);
    } else {
      groups['Older'].push(session);
    }
  }

  return Object.entries(groups)
    .filter(([, s]) => s.length > 0)
    .map(([label, s]) => ({ label, sessions: s }));
}

export function ChatSessionList({
  sessions,
  currentSessionId,
  isLoading,
  isSearching = false,
  onClearSearch,
  onLoadSession,
  onDeleteSession,
}: ChatSessionListProps) {
  const dateGroups = useMemo(() => isSearching
    ? [{ label: 'Search results', sessions }]
    : groupSessionsByDate(sessions), [sessions, isSearching]);

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

  if (sessions.length === 0 && isSearching) {
    return (
      <div className="px-5 py-8 text-center">
        <Search aria-hidden="true" className="mx-auto mb-3 h-5 w-5 text-sidebar-foreground/40" />
        <p className="text-[13px] font-medium text-sidebar-foreground">No matching chats</p>
        <p className="mt-1 text-[12px] text-sidebar-foreground/60">Try a different title or keyword.</p>
        <button type="button" onClick={onClearSearch} className="mt-3 rounded-sm px-2 py-1 text-[12px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Show all chats
        </button>
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
    <TooltipProvider delayDuration={600}>
      <div className="px-2">
        {dateGroups.map((group) => (
          <div key={group.label} className="mb-3">
            {!isSearching && (
              <div className="px-3 pt-3 pb-1.5">
                <span className="text-[11px] font-medium text-sidebar-foreground/60">
                  {group.label}
                </span>
              </div>
            )}
            <div className="space-y-1">
              {group.sessions.map((session) => {
                const isCurrentSession = session.sessionId === currentSessionId;
                const showUnseen =
                  session.hasUnseenUpdate === true && !isCurrentSession;
                return (
                  <div
                    key={session.sessionId}
                    className={`group/session flex items-center gap-1 rounded-lg px-1 transition-colors hover:bg-sidebar-accent/70 ${
                      isCurrentSession ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''
                    }`}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={session.title}
                          aria-current={isCurrentSession ? 'page' : undefined}
                          disabled={!onLoadSession}
                          onClick={() => onLoadSession?.(session.sessionId)}
                          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2.5 text-left text-[13px] leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                            isCurrentSession ? 'font-medium text-primary' : 'text-sidebar-foreground'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{session.title}</span>
                          {showUnseen && (
                            <span role="status" aria-label="New activity" title="New activity" className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500 dark:bg-sky-400" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="start" className="max-w-[280px] break-words text-[12px]" sideOffset={4}>
                        <p>{session.title}</p>
                      </TooltipContent>
                    </Tooltip>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteSession(session.sessionId, e)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/50 opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover/session:opacity-100 group-focus-within/session:opacity-100"
                      title="Delete"
                      aria-label={`Delete ${session.title}`}
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
