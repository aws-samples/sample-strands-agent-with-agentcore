'use client';

import React from 'react';
import { Tool } from '@/types/chat';
import { SidebarMenuItem } from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface ToolItemProps {
  tool: Tool;
  onToggleTool: (toolId: string) => void;
}

export function ToolItem({ tool, onToggleTool }: ToolItemProps) {
  // Check if this is a grouped tool (isDynamic)
  const isDynamic = (tool as any).isDynamic === true;
  const nestedTools = (tool as any).tools || [];

  if (isDynamic) {
    // Render as group with nested tools
    const anyToolEnabled = nestedTools.some((nestedTool: any) => nestedTool.enabled);
    const allToolsEnabled = nestedTools.every((nestedTool: any) => nestedTool.enabled);

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={async () => {
                // If all tools are enabled, disable all
                // If some or none are enabled, enable all
                const shouldEnable = !allToolsEnabled;

                // Toggle each nested tool sequentially to avoid race conditions
                for (const nestedTool of nestedTools) {
                  // Only toggle if the tool's current state doesn't match the target state
                  if (nestedTool.enabled !== shouldEnable) {
                    await onToggleTool(nestedTool.id);
                  }
                }
              }}
              className={cn(
                "w-full flex items-center justify-center py-1.5 px-2 rounded-md transition-all duration-200 cursor-pointer border min-h-[36px] relative",
                anyToolEnabled
                  ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700 shadow-sm hover:shadow-md hover:scale-[1.02]"
                  : "bg-sidebar-accent/40 text-sidebar-foreground border-sidebar-border hover:border-sidebar-border/80 hover:bg-sidebar-accent/60 hover:scale-[1.02] opacity-80 hover:opacity-100"
              )}
            >
              {anyToolEnabled && (
                <div className="absolute top-1 right-1">
                  <Check className="h-3 w-3" />
                </div>
              )}
              <div className="font-medium text-[11px] text-center leading-snug line-clamp-2 w-full">
                {tool.name}
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs">
            <p className="text-sm mb-1">{tool.description}</p>
            <p className="text-xs opacity-70">{nestedTools.length} tools included</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  } else {
    // Render as individual tool
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onToggleTool(tool.id)}
              className={cn(
                "w-full flex items-center justify-center py-1.5 px-2 rounded-md transition-all duration-200 cursor-pointer border min-h-[36px] relative",
                tool.enabled
                  ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700 shadow-sm hover:shadow-md hover:scale-[1.02]"
                  : "bg-sidebar-accent/40 text-sidebar-foreground border-sidebar-border hover:border-sidebar-border/80 hover:bg-sidebar-accent/60 hover:scale-[1.02] opacity-80 hover:opacity-100"
              )}
            >
              {tool.enabled && (
                <div className="absolute top-1 right-1">
                  <Check className="h-3 w-3" />
                </div>
              )}
              <div className="font-medium text-[11px] text-center leading-snug line-clamp-2 w-full">
                {tool.name}
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs">
            <p>{tool.description}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
}
