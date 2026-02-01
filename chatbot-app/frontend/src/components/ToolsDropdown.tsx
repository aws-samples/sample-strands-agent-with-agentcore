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
import { Sparkles, Search, Check, Zap } from 'lucide-react';
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
        className="w-[380px] max-w-[calc(100vw-2rem)] h-[480px] max-h-[70vh] p-0 shadow-xl rounded-xl flex flex-col overflow-hidden"
        sideOffset={12}
      >
        {/* Auto Mode Toggle */}
        {onToggleAuto && (
          <div className="px-4 pt-4 pb-3 border-b border-border/50 shrink-0">
            <div
              onClick={() => onToggleAuto(!autoEnabled)}
              className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all duration-200 ${
                autoEnabled
                  ? 'bg-gradient-to-r from-purple-500/15 to-violet-500/15 border border-purple-300/50 dark:border-purple-700/50'
                  : 'bg-muted/30 hover:bg-muted/50 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all ${
                  autoEnabled
                    ? 'bg-purple-500 shadow-lg shadow-purple-500/30'
                    : 'bg-slate-200 dark:bg-slate-700'
                }`}>
                  <Zap className={`w-4 h-4 ${autoEnabled ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`} />
                </div>
                <div>
                  <div className={`text-label font-semibold ${autoEnabled ? 'text-purple-700 dark:text-purple-300' : 'text-foreground'}`}>
                    Auto Mode
                  </div>
                  <div className="text-caption text-muted-foreground">
                    AI automatically selects tools
                  </div>
                </div>
              </div>
              <Switch
                checked={autoEnabled}
                onCheckedChange={onToggleAuto}
                className="data-[state=checked]:bg-purple-500"
              />
            </div>
          </div>
        )}

        {/* Header */}
        <div className={`p-4 border-b shrink-0 ${autoEnabled ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-label font-semibold flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <Sparkles className="w-4 h-4" />
              Manual Selection
            </h3>
            <span className="text-caption font-medium px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
              {enabledCount} active
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
              disabled={autoEnabled}
              className="pl-9 h-9 text-label bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus-visible:ring-2 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500"
            />
          </div>
        </div>

        {/* Tool List */}
        <div className={`flex-1 overflow-y-auto ${autoEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="p-4 space-y-3">
              {/* Active Tools Section */}
              {!searchQuery && enabledTools.length > 0 && (
                <div className="mb-5">
                  <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3.5 py-2.5 mb-3 rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 shadow-sm">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 dark:bg-emerald-600">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                      <span className="text-label font-semibold text-emerald-900 dark:text-emerald-100">
                        Active Tools
                      </span>
                      <span className="text-caption font-bold px-2 py-0.5 rounded-full bg-emerald-200 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200">
                        {enabledTools.length}
                      </span>
                      <button
                        onClick={handleClearAll}
                        className="ml-auto text-caption font-semibold px-2.5 py-1 rounded-md hover:bg-emerald-200/60 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 transition-colors"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 px-1">
                    {enabledTools.map((tool) => {
                      const ToolIcon = getToolIcon(tool.id);
                      const isDynamic = (tool as any).isDynamic === true;
                      const nestedTools = (tool as any).tools || [];

                      return (
                        <TooltipProvider key={tool.id} delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleToolToggle(tool.id, tool)}
                                className="group flex items-center justify-center w-10 h-10 rounded-lg transition-all cursor-pointer bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 border border-emerald-200 hover:border-emerald-300 dark:border-emerald-800/60 dark:hover:border-emerald-700 shadow-sm hover:shadow-md"
                              >
                                <ToolIcon className="w-5 h-5 text-emerald-700 dark:text-emerald-300 shrink-0 transition-transform group-hover:scale-110" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs z-50">
                              <div className="space-y-1">
                                <p className="font-semibold">{tool.name}</p>
                                <p className="text-label text-muted-foreground">{tool.description}</p>
                                {isDynamic && nestedTools.length > 0 && (
                                  <p className="text-caption opacity-70 mt-1">{nestedTools.length} tools included</p>
                                )}
                              </div>
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
                  <div className="px-3 py-2 mb-2 text-caption font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg border border-emerald-200/50 dark:border-emerald-800/30">
                    <div className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 dark:bg-emerald-600">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                    Active Tools ({filteredEnabledTools.length})
                  </div>
                  <div className="flex flex-wrap gap-2 px-1">
                    {filteredEnabledTools.map((tool) => {
                      const ToolIcon = getToolIcon(tool.id);
                      const isDynamic = (tool as any).isDynamic === true;
                      const nestedTools = (tool as any).tools || [];

                      return (
                        <TooltipProvider key={tool.id} delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleToolToggle(tool.id, tool)}
                                className="group flex items-center justify-center w-10 h-10 rounded-lg transition-all cursor-pointer bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 border border-emerald-200 hover:border-emerald-300 dark:border-emerald-800/60 dark:hover:border-emerald-700 shadow-sm hover:shadow-md"
                              >
                                <ToolIcon className="w-5 h-5 text-emerald-700 dark:text-emerald-300 shrink-0 transition-transform group-hover:scale-110" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs z-50">
                              <div className="space-y-1">
                                <p className="font-semibold">{tool.name}</p>
                                <p className="text-label text-muted-foreground">{tool.description}</p>
                                {isDynamic && nestedTools.length > 0 && (
                                  <p className="text-caption opacity-70 mt-1">{nestedTools.length} tools included</p>
                                )}
                              </div>
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
                              <div className={`text-caption truncate ${
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
                          <p className="text-label">{tool.description}</p>
                          {isDynamic && nestedTools.length > 0 && (
                            <p className="text-caption opacity-70 mt-1">{nestedTools.length} tools included</p>
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
