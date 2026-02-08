'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Tool } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Sparkles, Check, Zap, KeyRound } from 'lucide-react';
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

  // Sort tools: enabled tools first, then alphabetical
  const sortedTools = useMemo(() => {
    const checkEnabled = (tool: Tool): boolean => {
      const isDynamic = (tool as any).isDynamic === true;
      const nestedTools = (tool as any).tools || [];
      if (isDynamic && nestedTools.length > 0) {
        return nestedTools.some((nt: any) => nt.enabled);
      }
      return tool.enabled;
    };

    return [...allTools].sort((a, b) => {
      const aEnabled = checkEnabled(a) ? 1 : 0;
      const bEnabled = checkEnabled(b) ? 1 : 0;
      if (aEnabled !== bEnabled) return bEnabled - aEnabled;
      return a.name.localeCompare(b.name);
    });
  }, [allTools, availableTools]);

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
                className={`h-9 w-9 p-0 transition-all ${
                  disabled
                    ? 'opacity-40 cursor-not-allowed'
                    : autoEnabled
                    ? 'bg-purple-500/15 hover:bg-purple-500/25 text-purple-500'
                    : enabledCount > 0
                    ? 'bg-primary/15 hover:bg-primary/25 text-primary'
                    : 'hover:bg-muted text-muted-foreground'
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
        className="w-[300px] p-0"
        sideOffset={12}
      >
        {/* Auto Mode Toggle */}
        {onToggleAuto && (
          <div className="px-3 py-2.5 border-b">
            <div
              onClick={() => onToggleAuto(!autoEnabled)}
              className="flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <Zap className={`w-[18px] h-[18px] ${autoEnabled ? 'text-purple-500' : 'text-muted-foreground'}`} />
                <div>
                  <div className={`text-base ${autoEnabled ? 'text-purple-600 dark:text-purple-400' : 'text-foreground'}`}>
                    Auto Mode
                  </div>
                  <div className="text-sm text-muted-foreground">
                    AI selects tools automatically
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

        {/* Command - Search + Tool List */}
        <Command className={`${autoEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
          <div className="flex items-center border-b px-3">
            <CommandInput
              placeholder="Search tools..."
              className="h-9"
            />
            {enabledCount > 0 && (
              <button
                onClick={handleClearAll}
                className="text-sm text-muted-foreground hover:text-destructive transition-colors whitespace-nowrap ml-2"
              >
                Clear
              </button>
            )}
          </div>
          <CommandList className="max-h-[240px]">
            <CommandEmpty className="py-6 text-center text-base text-muted-foreground">
              No tools found
            </CommandEmpty>
            <CommandGroup>
              {sortedTools.map((tool) => {
                const ToolIcon = getToolIcon(tool.id);
                const enabled = isToolEnabled(tool);
                const isDynamic = (tool as any).isDynamic === true;
                const nestedTools = (tool as any).tools || [];
                const enabledNestedCount = getEnabledNestedCount(tool);
                const available = isToolAvailable(tool.id);

                return (
                  <CommandItem
                    key={tool.id}
                    value={tool.name}
                    onSelect={() => available && handleToolToggle(tool.id, tool)}
                    disabled={!available}
                    className={`flex items-center gap-3 ${
                      enabled ? 'bg-primary/5' : ''
                    } ${!available ? 'opacity-50' : ''}`}
                  >
                    <ToolIcon className={`w-4 h-4 shrink-0 ${
                      !available ? 'text-muted-foreground/50' : enabled ? 'text-primary' : 'text-muted-foreground'
                    }`} />

                    <div className="flex-1 min-w-0">
                      <span className={`text-base truncate ${
                        enabled ? 'text-primary' : ''
                      }`}>
                        {tool.name}
                      </span>
                      {isDynamic && nestedTools.length > 0 && (
                        <span className="text-sm text-muted-foreground ml-1.5">
                          {enabled ? `${enabledNestedCount}/${nestedTools.length}` : `${nestedTools.length}`}
                        </span>
                      )}
                    </div>

                    {!available ? (
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <KeyRound className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="text-xs">
                            <p>API Key required</p>
                            <p className="text-muted-foreground">Settings → API Keys</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : enabled ? (
                      <Check className="w-4 h-4 text-primary shrink-0" />
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
