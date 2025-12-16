'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';
import { Tool } from '@/types/chat';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
} from '@/components/ui/sidebar';
import { Switch } from '@/components/ui/switch';
import { ToolItem } from './ToolItem';

interface ToolSectionProps {
  title: string;
  icon: LucideIcon;
  tools: Tool[];
  category: 'local' | 'builtin' | 'browser_automation' | 'gateway' | 'runtime-a2a';
  showToggleAll?: boolean;
  onToggleTool: (toolId: string) => void;
  onToggleCategory?: (category: 'local' | 'builtin' | 'browser_automation' | 'gateway' | 'runtime-a2a') => void;
  areAllEnabled?: boolean;
}

export function ToolSection({
  title,
  icon: Icon,
  tools,
  category,
  showToggleAll = true,
  onToggleTool,
  onToggleCategory,
  areAllEnabled,
}: ToolSectionProps) {
  if (tools.length === 0) {
    return null;
  }

  return (
    <SidebarGroup className="mb-3">
      <SidebarGroupLabel className="flex items-center justify-between">
        <div className="flex items-center">
          <Icon className="h-4 w-4 mr-2" />
          {title}
        </div>
        {showToggleAll && onToggleCategory && (
          <Switch
            checked={areAllEnabled}
            onCheckedChange={() => onToggleCategory(category)}
            className="scale-75 data-[state=checked]:bg-blue-600"
          />
        )}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
          {tools.map((tool) => (
            <ToolItem key={tool.id} tool={tool} onToggleTool={onToggleTool} />
          ))}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
