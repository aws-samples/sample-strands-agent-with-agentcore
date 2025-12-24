'use client';

import React, { useState, useMemo } from 'react';
import { Tool } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Wrench, Search, Check } from 'lucide-react';
import { getToolIcon } from '@/config/tool-icons';

interface ToolsDropdownProps {
  availableTools: Tool[];
  onToggleTool: (toolId: string) => void;
  disabled?: boolean;
}

export function ToolsDropdown({ availableTools, onToggleTool, disabled = false }: ToolsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Calculate enabled count (excluding Research Agent)
  const enabledCount = useMemo(() => {
    let count = 0;
    availableTools.forEach(tool => {
      // Exclude Research Agent from count
      if (tool.id === 'agentcore_research-agent') {
        return;
      }

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
      // Exclude Research Agent
      if (tool.id === 'agentcore_research-agent') {
        return;
      }

      const isDynamic = (tool as any).isDynamic === true;
      const nestedTools = (tool as any).tools || [];

      if (isDynamic && nestedTools.length > 0) {
        // Check if any nested tool is enabled
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
    if (!searchQuery.trim()) {
      return allTools;
    }

    const query = searchQuery.toLowerCase();
    return allTools.filter(tool => {
      const nameMatch = tool.name.toLowerCase().includes(query);
      const descMatch = tool.description?.toLowerCase().includes(query);
      const tags = (tool as any).tags || [];
      const tagMatch = tags.some((tag: string) => tag.toLowerCase().includes(query));
      return nameMatch || descMatch || tagMatch;
    });
  }, [allTools, searchQuery]);

  // Filter enabled tools based on search
  const filteredEnabledTools = useMemo(() => {
    if (!searchQuery.trim()) {
      return enabledTools;
    }

    const query = searchQuery.toLowerCase();
    return enabledTools.filter(
      tool => {
        const nameMatch = tool.name.toLowerCase().includes(query);
        const descMatch = tool.description?.toLowerCase().includes(query);
        const tags = (tool as any).tags || [];
        const tagMatch = tags.some((tag: string) => tag.toLowerCase().includes(query));
        return nameMatch || descMatch || tagMatch;
      }
    );
  }, [enabledTools, searchQuery]);

  const handleToolToggle = (toolId: string, tool: Tool) => {
    const isDynamic = (tool as any).isDynamic === true;
    const nestedTools = (tool as any).tools || [];

    if (isDynamic && nestedTools.length > 0) {
      // Toggle all nested tools
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
      handleToolToggle(tool.id, tool);
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
                className={`h-7 px-3 transition-all duration-200 text-xs font-medium flex items-center gap-1.5 ${
                  disabled
                    ? 'opacity-40 cursor-not-allowed hover:bg-transparent'
                    : 'hover:bg-muted-foreground/10'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                Tools ({enabledCount})
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>{disabled ? 'Tool selection disabled' : 'Select specific tools to enhance AI abilities'}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="start"
        side="top"
        className="w-[420px] max-w-[calc(100vw-2rem)] h-[500px] max-h-[70vh] p-0 shadow-lg flex flex-col"
        sideOffset={10}
      >
        {/* Header */}
        <div className="p-4 border-b shrink-0 bg-gradient-to-b from-slate-50/50 to-transparent dark:from-slate-900/50">
          <div className="flex items-center justify-between mb-3.5">
            <h3 className="text-base font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <Wrench className="w-4.5 h-4.5 text-slate-700 dark:text-slate-300" />
              Tools
            </h3>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              {enabledCount} enabled
            </span>
          </div>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
            <Input
              type="text"
              placeholder="Search tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus-visible:ring-2 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500"
            />
          </div>
        </div>

        {/* Tool List */}
        <div className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-3">
              {/* Active Tools Section */}
              {!searchQuery && enabledTools.length > 0 && (
                <div className="mb-5">
                  <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3.5 py-2.5 mb-3 rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 shadow-sm">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 dark:bg-emerald-600">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                      <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                        Active Tools
                      </span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-200 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200">
                        {enabledTools.length}
                      </span>
                      <button
                        onClick={handleClearAll}
                        className="ml-auto text-xs font-semibold px-2.5 py-1 rounded-md hover:bg-emerald-200/60 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 transition-colors"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {enabledTools.map((tool) => {
                      const ToolIcon = getToolIcon(tool.id);
                      const isDynamic = (tool as any).isDynamic === true;
                      const nestedTools = (tool as any).tools || [];

                      return (
                        <TooltipProvider key={tool.id} delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                onClick={() => handleToolToggle(tool.id, tool)}
                                className="group w-full flex items-center gap-3 px-3.5 py-3 rounded-lg transition-all cursor-pointer bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 border border-emerald-200 hover:border-emerald-300 dark:border-emerald-800/60 dark:hover:border-emerald-700 shadow-sm hover:shadow-md"
                              >
                                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 group-hover:bg-emerald-200 dark:group-hover:bg-emerald-900/70 transition-colors">
                                  <ToolIcon className="w-4.5 h-4.5 text-emerald-700 dark:text-emerald-300 shrink-0 transition-transform group-hover:scale-110" />
                                </div>
                                <div className="flex-1 text-left min-w-0">
                                  <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 truncate">{tool.name}</div>
                                  {isDynamic && nestedTools.length > 0 && (
                                    <div className="text-xs text-emerald-700/70 dark:text-emerald-300/70 font-medium">
                                      {nestedTools.length} tools
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs">
                              <p className="text-sm">{tool.description}</p>
                              {isDynamic && nestedTools.length > 0 && (
                                <p className="text-xs opacity-70 mt-1">{nestedTools.length} tools included</p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Search Results for Active Tools */}
              {searchQuery && filteredEnabledTools.length > 0 && (
                <div className="mb-5">
                  <div className="px-3 py-2 mb-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg border border-emerald-200/50 dark:border-emerald-800/30">
                    <div className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 dark:bg-emerald-600">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                    Active Tools ({filteredEnabledTools.length})
                  </div>
                  <div className="space-y-2">
                    {filteredEnabledTools.map((tool) => {
                      const ToolIcon = getToolIcon(tool.id);
                      const isDynamic = (tool as any).isDynamic === true;
                      const nestedTools = (tool as any).tools || [];

                      return (
                        <TooltipProvider key={tool.id} delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                onClick={() => handleToolToggle(tool.id, tool)}
                                className="group w-full flex items-center gap-3 px-3.5 py-3 rounded-lg transition-all cursor-pointer bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 border border-emerald-200 hover:border-emerald-300 dark:border-emerald-800/60 dark:hover:border-emerald-700 shadow-sm hover:shadow-md"
                              >
                                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 group-hover:bg-emerald-200 dark:group-hover:bg-emerald-900/70 transition-colors">
                                  <ToolIcon className="w-4.5 h-4.5 text-emerald-700 dark:text-emerald-300 shrink-0 transition-transform group-hover:scale-110" />
                                </div>
                                <div className="flex-1 text-left min-w-0">
                                  <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 truncate">{tool.name}</div>
                                  {isDynamic && nestedTools.length > 0 && (
                                    <div className="text-xs text-emerald-700/70 dark:text-emerald-300/70 font-medium">
                                      {nestedTools.length} tools
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs">
                              <p className="text-sm">{tool.description}</p>
                              {isDynamic && nestedTools.length > 0 && (
                                <p className="text-xs opacity-70 mt-1">{nestedTools.length} tools included</p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* All Tools Grid (2 columns) */}
              <div className="grid grid-cols-2 gap-2.5">
                {filteredTools.map((tool) => {
                  const ToolIcon = getToolIcon(tool.id);
                  const enabled = isToolEnabled(tool);
                  const isDynamic = (tool as any).isDynamic === true;
                  const nestedTools = (tool as any).tools || [];

                  return (
                    <TooltipProvider key={tool.id} delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            onClick={() => handleToolToggle(tool.id, tool)}
                            className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all cursor-pointer ${
                              enabled
                                ? 'bg-emerald-50/80 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 border border-emerald-300 hover:border-emerald-400 dark:border-emerald-800/60 dark:hover:border-emerald-700 shadow-sm'
                                : 'bg-slate-50/50 hover:bg-slate-100 dark:bg-slate-900/30 dark:hover:bg-slate-800/50 border border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
                            }`}
                          >
                            <div className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                              enabled
                                ? 'bg-emerald-100 dark:bg-emerald-900/50 group-hover:bg-emerald-200 dark:group-hover:bg-emerald-900/70'
                                : 'bg-slate-100 dark:bg-slate-800/50 group-hover:bg-slate-200 dark:group-hover:bg-slate-700/70'
                            }`}>
                              <ToolIcon className={`w-4 h-4 shrink-0 transition-transform ${
                                enabled
                                  ? 'text-emerald-700 dark:text-emerald-300 group-hover:scale-110'
                                  : 'text-slate-600 dark:text-slate-400 group-hover:scale-105'
                              }`} />
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <div className={`text-xs truncate ${
                                enabled
                                  ? 'font-semibold text-emerald-900 dark:text-emerald-100'
                                  : 'font-medium text-slate-700 dark:text-slate-300'
                              }`}>{tool.name}</div>
                              {isDynamic && nestedTools.length > 0 && (
                                <div className={`text-[10px] font-medium ${
                                  enabled
                                    ? 'text-emerald-700/70 dark:text-emerald-300/70'
                                    : 'text-slate-600/70 dark:text-slate-400/70'
                                }`}>
                                  {nestedTools.length} tools
                                </div>
                              )}
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="text-sm">{tool.description}</p>
                          {isDynamic && nestedTools.length > 0 && (
                            <p className="text-xs opacity-70 mt-1">{nestedTools.length} tools included</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </div>
            </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
