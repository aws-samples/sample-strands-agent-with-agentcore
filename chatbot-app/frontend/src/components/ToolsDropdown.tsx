'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
import { Sparkles, Search, Check, Zap, X, KeyRound } from 'lucide-react';
import { getToolIcon } from '@/config/tool-icons';
import { apiGet } from '@/lib/api-client';

// Mapping of tool IDs to their required API keys
const TOOL_REQUIRED_KEYS: Record<string, string[]> = {
  'gateway_tavily-search': ['tavily_api_key'],
  'gateway_tavily_search': ['tavily_api_key'],
  'gateway_tavily_extract': ['tavily_api_key'],
  'gateway_google-web-search': ['google_api_key', 'google_search_engine_id'],
  'gateway_google_web_search': ['google_api_key', 'google_search_engine_id'],
  'gateway_google_image_search': ['google_api_key', 'google_search_engine_id'],
  'gateway_google-maps': ['google_maps_api_key'],
  'browser_automation': ['nova_act_api_key'],
};

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
  onToggleAuto,
}: ToolsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, boolean>>({});

  // Load configured API keys on mount and when dropdown opens
  useEffect(() => {
    const loadApiKeys = async () => {
      try {
        const data = await apiGet<{
          success: boolean;
          user_keys: Record<string, { configured: boolean }>;
          default_keys: Record<string, { configured: boolean }>;
        }>('settings/api-keys');

        if (data.success) {
          const configured: Record<string, boolean> = {};
          // Merge user keys and default keys - either one being configured is enough
          const allKeyNames = new Set([
            ...Object.keys(data.user_keys || {}),
            ...Object.keys(data.default_keys || {})
          ]);

          allKeyNames.forEach(keyName => {
            const userConfigured = data.user_keys?.[keyName]?.configured || false;
            const defaultConfigured = data.default_keys?.[keyName]?.configured || false;
            configured[keyName] = userConfigured || defaultConfigured;
          });

          setConfiguredKeys(configured);
        }
      } catch (error) {
        console.error('Failed to load API keys for tools:', error);
      }
    };

    loadApiKeys();
  }, [isOpen]);

  // Check if a tool has all required API keys configured
  const isToolAvailable = (toolId: string): boolean => {
    const requiredKeys = TOOL_REQUIRED_KEYS[toolId];
    if (!requiredKeys) return true;
    return requiredKeys.every(key => configuredKeys[key]);
  };

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

  // Get all tools (excluding Research Agent and Browser-Use Agent)
  const allTools = useMemo(() => {
    return availableTools.filter(tool =>
      tool.id !== 'agentcore_research-agent' &&
      tool.id !== 'agentcore_browser-use-agent'
    );
  }, [availableTools]);

  // Get all enabled tools (excluding Research Agent and Browser-Use Agent)
  const enabledTools = useMemo(() => {
    const enabled: Tool[] = [];
    availableTools.forEach(tool => {
      if (tool.id === 'agentcore_research-agent' || tool.id === 'agentcore_browser-use-agent') return;

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
              const available = isToolAvailable(tool.id);

              const toolItem = (
                <div
                  onClick={() => available && handleToolToggle(tool.id, tool)}
                  className={`group flex items-center gap-3 px-4 py-2.5 transition-colors ${
                    !available
                      ? 'opacity-50 cursor-not-allowed'
                      : enabled
                      ? 'bg-emerald-50/50 dark:bg-emerald-950/20 cursor-pointer'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-900/30 cursor-pointer'
                  }`}
                >
                  {/* Icon - no background */}
                  <ToolIcon className={`w-[18px] h-[18px] shrink-0 ${
                    !available ? 'text-slate-300' : enabled ? 'text-emerald-500' : 'text-slate-400'
                  }`} />

                  {/* Name & Description */}
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] truncate ${
                      !available
                        ? 'text-slate-400'
                        : enabled
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

                  {/* Check indicator or key icon for unavailable */}
                  {!available ? (
                    <KeyRound className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  ) : enabled ? (
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : null}
                </div>
              );

              return !available ? (
                <TooltipProvider key={tool.id} delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {toolItem}
                    </TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">
                      <p>API Key required</p>
                      <p className="text-muted-foreground">Settings → API Keys</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <div key={tool.id}>{toolItem}</div>
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
