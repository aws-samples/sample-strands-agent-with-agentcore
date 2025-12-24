'use client';

import React from 'react';
import { LucideIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { Tool } from '@/types/chat';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
} from '@/components/ui/sidebar';
import { ToolItem } from './ToolItem';

interface ToolSectionProps {
  title: string;
  icon: LucideIcon;
  tools: Tool[];
  onToggleTool: (toolId: string) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function ToolSection({
  title,
  icon: Icon,
  tools,
  onToggleTool,
  isExpanded,
  onToggleExpand,
}: ToolSectionProps) {
  if (tools.length === 0) {
    return null;
  }

  // Default to expanded if not controlled by parent
  const expanded = isExpanded !== undefined ? isExpanded : true;

  return (
    <SidebarGroup className="mb-3 bg-sidebar-accent/20 rounded-lg border border-sidebar-border/40 p-2">
      <SidebarGroupLabel
        className={`flex items-center ${onToggleExpand ? 'cursor-pointer hover:bg-sidebar-accent/50 rounded-md transition-colors px-2 py-1' : 'px-2'}`}
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-1.5">
          {onToggleExpand && (
            expanded ?
              <ChevronDown className="h-4 w-4 transition-transform text-sidebar-foreground/70" /> :
              <ChevronRight className="h-4 w-4 transition-transform text-sidebar-foreground/70" />
          )}
          <Icon className="h-4 w-4 text-sidebar-foreground/80" />
          <span className="font-semibold text-sm">{title}</span>
        </div>
      </SidebarGroupLabel>
      {expanded && (
        <SidebarGroupContent className="mt-2">
          <div className="grid grid-cols-2 gap-2">
            {tools.map((tool) => (
              <ToolItem key={tool.id} tool={tool} onToggleTool={onToggleTool} />
            ))}
          </div>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}
