'use client';

import React from 'react';
import { Settings, Wrench, Server, Brain, Plus, Globe } from 'lucide-react';
import { Tool } from '@/types/chat';
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
import { ToolSection } from './sidebar/ToolSection';
import { useChatSessions } from '@/hooks/useChatSessions';
import { useToolToggle } from '@/hooks/useToolToggle';

interface ToolSidebarProps {
  availableTools: Tool[];
  onToggleTool: (toolId: string) => void;
  onNewChat: () => void;
  refreshTools: () => Promise<void>;
  sessionId: string | null;
  loadSession?: (sessionId: string) => Promise<void>;
  onSessionListRefresh?: () => void;
  onGatewayToolsChange?: (enabledToolIds: string[]) => void;
}

export function ToolSidebar({
  availableTools,
  onToggleTool,
  onNewChat,
  refreshTools,
  sessionId,
  loadSession,
  onSessionListRefresh,
  onGatewayToolsChange,
}: ToolSidebarProps) {
  const { setOpenMobile } = useSidebar();

  // Use custom hooks
  const { chatSessions, isLoadingSessions, deleteSession } = useChatSessions({
    sessionId,
    onNewChat,
  });

  const { groupedTools, toggleCategory, areAllEnabled, enabledCount, totalCount } = useToolToggle({
    availableTools,
    onToggleTool,
  });

  return (
    <Sidebar
      side="left"
      className="group-data-[side=left]:border-r-0 bg-sidebar-background border-sidebar-border text-sidebar-foreground flex flex-col h-full"
    >
      {/* Header */}
      <SidebarHeader className="flex-shrink-0 border-b border-sidebar-border/50">
        <SidebarMenu>
          <div className="flex flex-row justify-between items-center">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-sidebar-foreground" />
              <span className="text-lg font-semibold text-sidebar-foreground">Chatbot</span>
            </div>
            <div className="flex items-center gap-1">
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
          </div>
        </SidebarMenu>
      </SidebarHeader>

      {/* Chat Sessions Section - Top (1/3) */}
      <div className="flex-[1] min-h-0 flex flex-col border-b-2 border-sidebar-border/80">
        <div className="flex-1 overflow-y-auto">
          <ChatSessionList
            sessions={chatSessions}
            currentSessionId={sessionId}
            isLoading={isLoadingSessions}
            onLoadSession={loadSession}
            onDeleteSession={deleteSession}
          />
        </div>
      </div>

      {/* Tools Section - Bottom (2/3) */}
      <div className="flex-[2] min-h-0 flex flex-col">
        <div className="flex-shrink-0 px-4 py-3 border-b border-sidebar-border/50 bg-sidebar-accent/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-sidebar-foreground" />
              <span className="text-sm font-semibold text-sidebar-foreground">Tools</span>
            </div>
            <span className="text-xs text-sidebar-foreground/60">
              {enabledCount}/{totalCount} enabled
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarContent>
            {availableTools.length > 0 && (
              <div className="animate-in fade-in-0 duration-300">
                {/* Local Tools */}
                <ToolSection
                  title="Local Tools"
                  icon={Wrench}
                  tools={groupedTools['local']}
                  category="local"
                  onToggleTool={onToggleTool}
                  onToggleCategory={toggleCategory}
                  areAllEnabled={areAllEnabled('local')}
                />

                {/* Built-In Tools */}
                <ToolSection
                  title="Built-In Tools"
                  icon={Brain}
                  tools={groupedTools['builtin']}
                  category="builtin"
                  onToggleTool={onToggleTool}
                  onToggleCategory={toggleCategory}
                  areAllEnabled={areAllEnabled('builtin')}
                />

                {/* AgentCore Gateway MCP Servers */}
                <ToolSection
                  title="AgentCore Gateway MCP Servers"
                  icon={Globe}
                  tools={groupedTools['gateway']}
                  category="gateway"
                  onToggleTool={onToggleTool}
                  onToggleCategory={toggleCategory}
                  areAllEnabled={areAllEnabled('gateway')}
                />

                {/* AgentCore Runtime A2A Agents */}
                <ToolSection
                  title="AgentCore Runtime A2A Agents"
                  icon={Server}
                  tools={groupedTools['runtime-a2a']}
                  category="runtime-a2a"
                  onToggleTool={onToggleTool}
                  onToggleCategory={toggleCategory}
                  areAllEnabled={areAllEnabled('runtime-a2a')}
                />
              </div>
            )}
          </SidebarContent>
        </div>
      </div>

      {/* Footer */}
      <SidebarFooter className="flex-shrink-0 border-t border-sidebar-border/50">
        <div className="text-xs text-sidebar-foreground/60 text-center">
          Press <kbd className="px-1.5 py-0.5 bg-sidebar-accent rounded text-xs font-mono">⌘B</kbd> to toggle
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
