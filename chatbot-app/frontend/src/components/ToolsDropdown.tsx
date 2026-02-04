'use client';

import React, { useState, useMemo } from 'react';
import { Tool } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Sparkles, Search, Check, Zap, X } from 'lucide-react';
import { getToolIcon } from '@/config/tool-icons';

interface ToolsDropdownProps {
  availableTools: Tool[];
  onToggleTool: (toolId: string) => void;
  disabled?: boolean;
  autoEnabled?: boolean;
  onToggleAuto?: (enabled: boolean) => void;
}

export function ToolsDropdown({
  availableTools,
  onToggleTool,
  disabled = false,
  autoEnabled = false,
  onToggleAuto
}: ToolsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Calculate enabled count (excluding Research Agent)
  const enabledCount = useMemo(() => {
    let count = 0;
    availableTools.forEach(tool => {
      if (tool.id === 'agentcore_research-agent') return;

      const isDynamic = (tool as any).isDynamic === true;
      const nestedTools = (tool as any).tools || [];

      if (isDynamic && nestedTools.length > 0) {
        count += nestedTools.filter((nt: any) => nt.enabled).length;
      } else if (tool.enabled) {
        count += 1;
      }
    });
    return count;
  }, [availableTools]);

  // Get all tools (excluding Research Agent)
  const allTools = useMemo(() => {
    return availableTools.filter(tool => tool.id !== 'agentcore_research-agent');
  }, [availableTools]);

  // Get all enabled tools (excluding Research Agent)
  const enabledTools = useMemo(() => {
    const enabled: Tool[] = [];
    availableTools.forEach(tool => {
      if (tool.id === 'agentcore_research-agent') return;

      const isDynamic = (tool as any).isDynamic === true;
      const nestedTools = (tool as any).tools || [];

      if (isDynamic && nestedTools.length > 0) {
        const hasEnabledNested = nestedTools.some((nt: any) => nt.enabled);
        if (hasEnabledNested) {
          enabled.push(tool);
        }
      } else if (tool.enabled) {
        enabled.push(tool);
      }
    });
    return enabled;
  }, [availableTools]);

  // Filter tools based on search
  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return allTools;

    const query = searchQuery.toLowerCase();
    return allTools.filter(tool => {
      const nameMatch = tool.name.toLowerCase().includes(query);
      const descMatch = tool.description?.toLowerCase().includes(query);
      const tags = (tool as any).tags || [];
      const tagMatch = tags.some((tag: string) => tag.toLowerCase().includes(query));
      return nameMatch || descMatch || tagMatch;
    });
  }, [allTools, searchQuery]);

  const handleToolToggle = (toolId: string, tool: Tool) => {
    const isDynamic = (tool as any).isDynamic === true;
    const nestedTools = (tool as any).tools || [];

    if (isDynamic && nestedTools.length > 0) {
      const allEnabled = nestedTools.every((nt: any) => nt.enabled);
      nestedTools.forEach((nestedTool: any) => {
        if (nestedTool.enabled === allEnabled) {
          onToggleTool(nestedTool.id);
        }
      });
    } else {
      onToggleTool(toolId);
    }
  };

  const handleClearAll = () => {
    enabledTools.forEach(tool => {
      const isDynamic = (tool as any).isDynamic === true;
      const nestedTools = (tool as any).tools || [];

      if (isDynamic && nestedTools.length > 0) {
        nestedTools.forEach((nestedTool: any) => {
          if (nestedTool.enabled) {
            onToggleTool(nestedTool.id);
          }
        });
      } else if (tool.enabled) {
        onToggleTool(tool.id);
      }
    });
  };

  const isToolEnabled = (tool: Tool): boolean => {
    const isDynamic = (tool as any).isDynamic === true;
    const nestedTools = (tool as any).tools || [];

    if (isDynamic && nestedTools.length > 0) {
      return nestedTools.some((nt: any) => nt.enabled);
    }
    return tool.enabled;
  };

  const getEnabledNestedCount = (tool: Tool): number => {
    const nestedTools = (tool as any).tools || [];
    return nestedTools.filter((nt: any) => nt.enabled).length;
  };

  return (
    <Popover open={isOpen && !disabled} onOpenChange={(open) => !disabled && setIsOpen(open)}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                className={`h-9 w-9 p-0 transition-all duration-200 ${
                  disabled
                    ? 'opacity-40 cursor-not-allowed hover:bg-transparent'
                    : autoEnabled
                    ? 'bg-purple-500/15 hover:bg-purple-500/25 text-purple-500'
                    : enabledCount > 0
                    ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400'
                    : 'hover:bg-muted-foreground/10 text-muted-foreground'
                }`}
              >
                <Sparkles className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>{disabled ? 'Disabled in Research mode' : autoEnabled ? 'Auto mode (AI selects tools)' : `Tools (${enabledCount} enabled)`}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent
        align="start"
        side="top"
        className="w-[280px] p-0 shadow-md rounded-xl border border-slate-200/80 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-950"
        sideOffset={12}
      >
        {/* Auto Mode Toggle */}
        {onToggleAuto && (
          <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800">
            <div
              onClick={() => onToggleAuto(!autoEnabled)}
              className={`flex items-center justify-between cursor-pointer transition-all`}
            >
              <div className="flex items-center gap-3">
                <Zap className={`w-[18px] h-[18px] ${autoEnabled ? 'text-purple-500' : 'text-slate-400'}`} />
                <div>
                  <div className={`text-[13px] ${autoEnabled ? 'text-purple-600 dark:text-purple-400' : 'text-slate-600 dark:text-slate-400'}`}>
                    Auto Mode
                  </div>
                  <div className="text-[11px] text-slate-400">
                    AI selects tools automatically
                  </div>
                </div>
              </div>
              <Switch
                checked={autoEnabled}
                onCheckedChange={onToggleAuto}
                className="data-[state=checked]:bg-purple-500 scale-90"
              />
            </div>
          </div>
        )}

        {/* Search + Clear */}
        <div className={`px-3 py-2 border-b border-slate-100 dark:border-slate-800 ${autoEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300" />
              <Input
                type="text"
                placeholder="Search tools..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={autoEnabled}
                className="pl-9 h-9 text-[13px] bg-slate-50/50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 focus-visible:ring-1 focus-visible:ring-slate-200 dark:focus-visible:ring-slate-700 rounded-lg placeholder:text-slate-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-500"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {enabledCount > 0 && (
              <button
                onClick={handleClearAll}
                className="text-[12px] text-slate-400 hover:text-rose-500 transition-colors whitespace-nowrap"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Tool List */}
        <div className={`max-h-[240px] overflow-y-auto ${autoEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
          <div className="py-1">
            {filteredTools.map((tool) => {
              const ToolIcon = getToolIcon(tool.id);
              const enabled = isToolEnabled(tool);
              const isDynamic = (tool as any).isDynamic === true;
              const nestedTools = (tool as any).tools || [];
              const enabledNestedCount = getEnabledNestedCount(tool);

              return (
                <div
                  key={tool.id}
                  onClick={() => handleToolToggle(tool.id, tool)}
                  className={`group flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    enabled
                      ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-900/30'
                  }`}
                >
                  {/* Icon - no background */}
                  <ToolIcon className={`w-[18px] h-[18px] shrink-0 ${
                    enabled ? 'text-emerald-500' : 'text-slate-400'
                  }`} />

                  {/* Name & Description */}
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] truncate ${
                      enabled
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}>
                      {tool.name}
                      {isDynamic && nestedTools.length > 0 && (
                        <span className="text-[11px] text-slate-400 ml-1.5">
                          {enabled ? `${enabledNestedCount}/${nestedTools.length}` : `${nestedTools.length}`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Check indicator */}
                  {enabled && (
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  )}
                </div>
              );
            })}

            {filteredTools.length === 0 && (
              <div className="py-8 text-center text-[13px] text-slate-400">
                No tools found
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
