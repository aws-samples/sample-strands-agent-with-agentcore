'use client';

import React, { useState, useMemo } from 'react';
import { Settings, Plus, Search, BarChart3, Globe, MapPin, Wrench } from 'lucide-react';
import { Tool } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
  const { setOpenMobile, isMobile } = useSidebar();

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Accordion state - track which sections are expanded
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    analytics: true,
    research: true,
    automation: true,
    location: true,
  });

  // Use custom hooks
  const { chatSessions, isLoadingSessions, deleteSession } = useChatSessions({
    sessionId,
    onNewChat,
  });

  // Custom tool grouping by purpose
  const groupedToolsByPurpose = useMemo(() => {
    const groups = {
      analytics: [] as Tool[],    // Analytics & Reports
      research: [] as Tool[],      // Research & Search
      automation: [] as Tool[],    // Web & Automation
      location: [] as Tool[],      // Location & Live Data
    };

    const analyticsIds = [
      'calculator',
      'create_visualization',
      'generate_diagram_and_validate',
      'word_document_tools',
      'excel_spreadsheet_tools',
      'powerpoint_presentation_tools',
      'gateway_financial-news',
    ];

    const researchIds = [
      'ddg_web_search',
      'gateway_google-web-search',
      'gateway_tavily-search',
      'gateway_wikipedia-search',
      'gateway_arxiv-search',
      'fetch_url_content',
    ];

    const automationIds = [
      'browser_automation',
      'agentcore_browser-use-agent',
    ];

    const locationIds = [
      'gateway_google-maps',
      'get_current_weather',
    ];

    availableTools.forEach(tool => {
      if (analyticsIds.includes(tool.id)) {
        groups.analytics.push(tool);
      } else if (researchIds.includes(tool.id)) {
        groups.research.push(tool);
      } else if (automationIds.includes(tool.id)) {
        groups.automation.push(tool);
      } else if (locationIds.includes(tool.id)) {
        groups.location.push(tool);
      }
    });

    return groups;
  }, [availableTools]);

  // Calculate enabled count
  const { enabledCount, totalCount } = useMemo(() => {
    let enabled = 0;
    let total = 0;

    availableTools.forEach(tool => {
      const isDynamic = (tool as any).isDynamic === true;
      const nestedTools = (tool as any).tools || [];

      if (isDynamic && nestedTools.length > 0) {
        total += nestedTools.length;
        enabled += nestedTools.filter((nt: any) => nt.enabled).length;
      } else {
        total += 1;
        if (tool.enabled) {
          enabled += 1;
        }
      }
    });

    return { enabledCount: enabled, totalCount: total };
  }, [availableTools]);

  // Toggle section expansion
  const toggleSection = (category: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  // Filter tools based on search query
  const filteredGroupedTools = useMemo(() => {
    if (!searchQuery.trim()) {
      return groupedToolsByPurpose;
    }

    const query = searchQuery.toLowerCase();
    const filtered: Record<string, Tool[]> = {};

    Object.entries(groupedToolsByPurpose).forEach(([category, tools]) => {
      const matchedTools = tools.filter(tool =>
        tool.name.toLowerCase().includes(query) ||
        tool.description?.toLowerCase().includes(query)
      );
      if (matchedTools.length > 0) {
        filtered[category] = matchedTools;
      }
    });

    return filtered;
  }, [groupedToolsByPurpose, searchQuery]);

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
              <span className="text-heading font-semibold text-sidebar-foreground">Chatbot</span>
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
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-sidebar-foreground" />
              <span className="text-label font-semibold text-sidebar-foreground">Tools</span>
            </div>
            <span className="text-caption text-sidebar-foreground/60">
              {enabledCount}/{totalCount} enabled
            </span>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-sidebar-foreground/50" />
            <Input
              type="text"
              placeholder="Search tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9 bg-sidebar-background border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/40"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarContent>
            {availableTools.length > 0 && (
              <div className="animate-in fade-in-0 duration-300 space-y-1">
                {/* Analytics & Reports */}
                {filteredGroupedTools['analytics'] && filteredGroupedTools['analytics'].length > 0 && (
                  <ToolSection
                    title="Analytics & Reports"
                    icon={BarChart3}
                    tools={filteredGroupedTools['analytics']}
                    onToggleTool={onToggleTool}
                    isExpanded={expandedSections['analytics']}
                    onToggleExpand={() => toggleSection('analytics')}
                  />
                )}

                {/* Research & Search */}
                {filteredGroupedTools['research'] && filteredGroupedTools['research'].length > 0 && (
                  <ToolSection
                    title="Research & Search"
                    icon={Search}
                    tools={filteredGroupedTools['research']}
                    onToggleTool={onToggleTool}
                    isExpanded={expandedSections['research']}
                    onToggleExpand={() => toggleSection('research')}
                  />
                )}

                {/* Web & Automation */}
                {filteredGroupedTools['automation'] && filteredGroupedTools['automation'].length > 0 && (
                  <ToolSection
                    title="Web & Automation"
                    icon={Globe}
                    tools={filteredGroupedTools['automation']}
                    onToggleTool={onToggleTool}
                    isExpanded={expandedSections['automation']}
                    onToggleExpand={() => toggleSection('automation')}
                  />
                )}

                {/* Location & Live Data */}
                {filteredGroupedTools['location'] && filteredGroupedTools['location'].length > 0 && (
                  <ToolSection
                    title="Location & Live Data"
                    icon={MapPin}
                    tools={filteredGroupedTools['location']}
                    onToggleTool={onToggleTool}
                    isExpanded={expandedSections['location']}
                    onToggleExpand={() => toggleSection('location')}
                  />
                )}
              </div>
            )}
          </SidebarContent>
        </div>
      </div>

      {/* Footer */}
      <SidebarFooter className="flex-shrink-0 border-t border-sidebar-border/50">
        <div className="text-caption text-sidebar-foreground/60 text-center">
          {isMobile ? (
            'Tap outside to close'
          ) : (
            <>
              Press <kbd className="px-1.5 py-0.5 bg-sidebar-accent rounded text-caption font-mono">⌘B</kbd> to toggle
            </>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
