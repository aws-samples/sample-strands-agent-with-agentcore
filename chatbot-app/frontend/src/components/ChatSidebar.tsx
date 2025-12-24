'use client';

import React from 'react';
import { Settings, Plus, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  useSidebar,
} from '@/components/ui/sidebar';
import { ChatSessionList } from './sidebar/ChatSessionList';
import { useChatSessions } from '@/hooks/useChatSessions';

interface ChatSidebarProps {
  sessionId: string | null;
  onNewChat: () => void;
  loadSession?: (sessionId: string) => Promise<void>;
}

export function ChatSidebar({
  sessionId,
  onNewChat,
  loadSession,
}: ChatSidebarProps) {
  const { isMobile } = useSidebar();

  // Use custom hooks
  const { chatSessions, isLoadingSessions, deleteSession } = useChatSessions({
    sessionId,
    onNewChat,
  });

  return (
    <Sidebar
      side="left"
      className="group-data-[side=left]:border-r-0 bg-sidebar-background border-sidebar-border text-sidebar-foreground flex flex-col h-full"
    >
      {/* Header */}
      <SidebarHeader className="flex-shrink-0 border-b border-sidebar-border/50 px-4 py-3">
        <SidebarMenu>
          <div className="flex flex-row justify-between items-center">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-sidebar-foreground" />
              <span className="text-lg font-semibold text-sidebar-foreground">Chatbot</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onNewChat}
              className="h-8 w-8 p-0"
              title="New chat"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </SidebarMenu>
      </SidebarHeader>

      {/* Chat Sessions */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <SidebarContent>
            <ChatSessionList
              sessions={chatSessions}
              currentSessionId={sessionId}
              isLoading={isLoadingSessions}
              onLoadSession={loadSession}
              onDeleteSession={deleteSession}
            />
          </SidebarContent>
        </div>
      </div>

      {/* Footer */}
      <SidebarFooter className="flex-shrink-0 border-t border-sidebar-border/50 py-2">
        <div className="text-xs text-sidebar-foreground/60 text-center">
          {isMobile ? (
            'Tap outside to close'
          ) : (
            <>
              Press <kbd className="px-1.5 py-0.5 bg-sidebar-accent rounded text-xs font-mono">⌘B</kbd> to toggle
            </>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
