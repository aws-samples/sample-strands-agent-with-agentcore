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
                "w-full flex flex-col items-center justify-center gap-1 py-2 px-2 rounded-lg transition-all duration-200 cursor-pointer border min-h-[52px] relative",
                anyToolEnabled
                  ? "bg-blue-600 text-white border-blue-500 hover:bg-blue-700 shadow-md hover:shadow-lg hover:shadow-blue-500/30 hover:scale-[1.03] ring-2 ring-blue-400/20"
                  : "bg-sidebar-accent/30 text-sidebar-foreground border-sidebar-border/60 hover:border-sidebar-border hover:bg-sidebar-accent/50 hover:scale-[1.03] hover:shadow-md opacity-85 hover:opacity-100"
              )}
            >
              {anyToolEnabled && (
                <div className="absolute top-1.5 right-1.5">
                  <Check className="h-3.5 w-3.5" />
                </div>
              )}
              {tool.icon && (
                <div className="text-heading leading-none">
                  {tool.icon}
                </div>
              )}
              <div className="font-medium text-[10.5px] text-center leading-tight line-clamp-2 w-full">
                {tool.name}
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs">
            <p className="text-label mb-1">{tool.description}</p>
            <p className="text-caption opacity-70">{nestedTools.length} tools included</p>
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
                "w-full flex flex-col items-center justify-center gap-1 py-2 px-2 rounded-lg transition-all duration-200 cursor-pointer border min-h-[52px] relative",
                tool.enabled
                  ? "bg-blue-600 text-white border-blue-500 hover:bg-blue-700 shadow-md hover:shadow-lg hover:shadow-blue-500/30 hover:scale-[1.03] ring-2 ring-blue-400/20"
                  : "bg-sidebar-accent/30 text-sidebar-foreground border-sidebar-border/60 hover:border-sidebar-border hover:bg-sidebar-accent/50 hover:scale-[1.03] hover:shadow-md opacity-85 hover:opacity-100"
              )}
            >
              {tool.enabled && (
                <div className="absolute top-1.5 right-1.5">
                  <Check className="h-3.5 w-3.5" />
                </div>
              )}
              {tool.icon && (
                <div className="text-heading leading-none">
                  {tool.icon}
                </div>
              )}
              <div className="font-medium text-[10.5px] text-center leading-tight line-clamp-2 w-full">
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
