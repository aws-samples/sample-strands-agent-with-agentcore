'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Tool } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Sparkles, Search, Zap, KeyRound } from 'lucide-react';
import { getToolIcon, getToolImageSrc } from '@/config/tool-icons';
import { apiGet } from '@/lib/api-client';
import { cn } from '@/lib/utils';

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

// Per-tool brand colors (hex)
const TOOL_BRAND_COLORS: Record<string, string> = {
  // Search
  'ddg_web_search':              '#DE5833',
  'gateway_google_web_search':   '#4285F4',
  'gateway_google-web-search':   '#4285F4',
  'gateway_google_image_search': '#4285F4',
  'gateway_tavily_search':       '#6366F1',
  'gateway_tavily-search':       '#6366F1',
  'gateway_tavily_extract':      '#6366F1',
  'gateway_arxiv_search':        '#B31B1B',
  'gateway_arxiv-search':        '#B31B1B',
  'gateway_wikipedia_search':    '#636363',
  'gateway_wikipedia-search':    '#636363',
  'fetch_url_content':           '#3B82F6',
  'gateway_financial_news':      '#16A34A',
  'gateway_financial-news':      '#16A34A',
  // Personal
  'mcp_gmail':                   '#EA4335',
  'mcp_calendar':                '#4285F4',
  'mcp_notion':                  '#787774',
  // Documents
  'word_document_tools':         '#2B579A',
  'excel_spreadsheet_tools':     '#217346',
  'powerpoint_presentation_tools': '#D24726',
  'generate_diagram_and_validate': '#8B5CF6',
  'calculator':                  '#6366F1',
  'create_visualization':        '#F59E0B',
  // Browser
  'browser_automation':          '#7C3AED',
  // Location
  'gateway_weather':             '#0EA5E9',
  'get_current_weather':         '#0EA5E9',
  'gateway_google_maps':         '#34A853',
  'gateway_google-maps':         '#34A853',
  'gateway_show_on_map':         '#34A853',
};

function getToolColor(toolId: string): string {
  return TOOL_BRAND_COLORS[toolId] || '#64748B';
}

// Display name overrides for cleaner labels
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  'browser_automation': 'Nova Act Browser',
  'create_visualization': 'Visualization',
  'generate_diagram_and_validate': 'Diagram',
  'excel_spreadsheet_tools': 'Excel',
  'powerpoint_presentation_tools': 'PowerPoint',
  'word_document_tools': 'Word',
  'gateway_financial_news': 'Finance',
  'gateway_financial-news': 'Finance',
};

function getToolDisplayName(toolId: string, originalName: string): string {
  return TOOL_DISPLAY_NAMES[toolId] || originalName;
}

// Category definitions for tab filtering
type ToolCategory = 'all' | 'search' | 'personal' | 'documents' | 'browser' | 'location';

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  all: 'All',
  search: 'Search',
  personal: 'Personal',
  documents: 'Documents',
  browser: 'Browser',
  location: 'Location',
};

const CATEGORY_TOOL_IDS: Record<Exclude<ToolCategory, 'all'>, string[]> = {
  search: [
    'ddg_web_search',
    'gateway_google_web_search', 'gateway_google-web-search',
    'gateway_tavily_search', 'gateway_tavily-search', 'gateway_tavily_extract',
    'gateway_arxiv_search', 'gateway_arxiv-search',
    'gateway_wikipedia_search', 'gateway_wikipedia-search',
    'fetch_url_content',
    'gateway_financial_news', 'gateway_financial-news',
    'gateway_google_image_search',
  ],
  personal: [
    'mcp_gmail',
    'mcp_calendar',
    'mcp_notion',
  ],
  documents: [
    'word_document_tools',
    'excel_spreadsheet_tools',
    'powerpoint_presentation_tools',
    'generate_diagram_and_validate',
    'calculator',
    'create_visualization',
  ],
  browser: [
    'browser_automation',
  ],
  location: [
    'gateway_weather', 'get_current_weather',
    'gateway_google_maps', 'gateway_google-maps', 'gateway_show_on_map',
  ],
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
  const [activeTab, setActiveTab] = useState<ToolCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

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

  const isToolAvailable = (toolId: string): boolean => {
    const requiredKeys = TOOL_REQUIRED_KEYS[toolId];
    if (!requiredKeys) return true;
    return requiredKeys.every(key => configuredKeys[key]);
  };

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

  const allTools = useMemo(() => {
    return availableTools.filter(tool =>
      tool.id !== 'agentcore_research-agent' &&
      tool.id !== 'agentcore_browser-use-agent'
    );
  }, [availableTools]);

  const enabledTools = useMemo(() => {
    const enabled: Tool[] = [];
    availableTools.forEach(tool => {
      if (tool.id === 'agentcore_research-agent' || tool.id === 'agentcore_browser-use-agent') return;
      const isDynamic = (tool as any).isDynamic === true;
      const nestedTools = (tool as any).tools || [];
      if (isDynamic && nestedTools.length > 0) {
        if (nestedTools.some((nt: any) => nt.enabled)) enabled.push(tool);
      } else if (tool.enabled) {
        enabled.push(tool);
      }
    });
    return enabled;
  }, [availableTools]);

  const filteredTools = useMemo(() => {
    let tools = [...allTools];

    if (activeTab !== 'all') {
      const categoryIds = CATEGORY_TOOL_IDS[activeTab];
      tools = tools.filter(tool => categoryIds.includes(tool.id));
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      tools = tools.filter(tool => tool.name.toLowerCase().includes(query));
    }

    tools.sort((a, b) => a.name.localeCompare(b.name));
    return tools;
  }, [allTools, activeTab, searchQuery]);

  const handleToolToggle = (toolId: string, tool: Tool) => {
    const isDynamic = (tool as any).isDynamic === true;
    const nestedTools = (tool as any).tools || [];
    if (isDynamic && nestedTools.length > 0) {
      const allEnabled = nestedTools.every((nt: any) => nt.enabled);
      nestedTools.forEach((nestedTool: any) => {
        if (nestedTool.enabled === allEnabled) onToggleTool(nestedTool.id);
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
          if (nestedTool.enabled) onToggleTool(nestedTool.id);
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

  const handleOpenChange = (open: boolean) => {
    if (disabled) return;
    setIsOpen(open);
    if (!open) {
      setSearchQuery('');
      setActiveTab('all');
    }
  };

  return (
    <Dialog open={isOpen && !disabled} onOpenChange={handleOpenChange}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
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
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>{disabled ? 'Disabled in Research mode' : autoEnabled ? 'Auto mode (AI selects tools)' : `Tools (${enabledCount} enabled)`}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DialogContent className="max-w-2xl w-full p-0 gap-0 overflow-hidden" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <DialogTitle className="text-lg font-semibold">Tools</DialogTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            Select tools for the agent to use
          </p>
        </div>

        {/* Auto Mode Toggle */}
        {onToggleAuto && (
          <div className="px-6 pb-4">
            <div
              onClick={() => onToggleAuto(!autoEnabled)}
              className={cn(
                'flex items-center justify-between cursor-pointer rounded-2xl border p-4 transition-all',
                autoEnabled
                  ? 'bg-purple-500/5 border-purple-500/20'
                  : 'hover:bg-muted/40'
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    backgroundColor: autoEnabled ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.08)',
                  }}
                >
                  <Zap className="w-[18px] h-[18px]" style={{ color: '#8B5CF6' }} />
                </div>
                <div className={cn('text-[15px] font-semibold', autoEnabled ? 'text-purple-600 dark:text-purple-400' : 'text-foreground')}>
                  Auto Mode
                </div>
                <div className="text-sm text-muted-foreground">
                  Swarm-based auto tool selection · Longer reasoning
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

        {/* Tab bar + Search */}
        <div className={cn('px-6 pb-4 space-y-3', autoEnabled && 'opacity-40 pointer-events-none')}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              {(Object.keys(CATEGORY_LABELS) as ToolCategory[]).map((category) => (
                <button
                  key={category}
                  onClick={() => setActiveTab(category)}
                  className={cn(
                    'rounded-full px-4 py-2 text-[15px] font-medium transition-all',
                    activeTab === category
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {CATEGORY_LABELS[category]}
                </button>
              ))}
            </div>
            {enabledCount > 0 && (
              <button
                onClick={handleClearAll}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors whitespace-nowrap"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border-0 bg-muted/40 pl-9 pr-3 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 focus:bg-muted/60 transition-colors"
            />
          </div>
        </div>

        {/* Tool grid */}
        <div className={cn(
          'pl-6 pr-3 pb-6 mr-1 overflow-y-auto max-h-[50vh] skills-scrollbar',
          autoEnabled && 'opacity-40 pointer-events-none'
        )}>
          {filteredTools.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No tools found
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {filteredTools.map((tool) => {
                const ToolIcon = getToolIcon(tool.id);
                const imageSrc = getToolImageSrc(tool.id);
                const enabled = isToolEnabled(tool);
                const available = isToolAvailable(tool.id);
                const brandColor = getToolColor(tool.id);

                return (
                  <div
                    key={tool.id}
                    onClick={() => available && handleToolToggle(tool.id, tool)}
                    className={cn(
                      'group rounded-2xl border p-4 cursor-pointer transition-all duration-200',
                      enabled
                        ? 'border-primary/25 bg-primary/[0.04] shadow-sm shadow-primary/5'
                        : 'border-transparent bg-muted/25 hover:bg-muted/50 hover:border-border/50',
                      !available && 'opacity-40 cursor-not-allowed'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {/* Icon */}
                      {imageSrc ? (
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 overflow-hidden bg-muted/30">
                          <img
                            src={imageSrc}
                            alt={tool.name}
                            className="w-8 h-8 object-contain"
                          />
                        </div>
                      ) : (
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${brandColor}14` }}
                        >
                          <ToolIcon
                            className="w-6 h-6"
                            style={{ color: brandColor }}
                          />
                        </div>
                      )}

                      {/* Tool name */}
                      <div className={cn(
                        'flex-1 min-w-0 text-[15px] font-medium leading-snug line-clamp-2',
                        enabled ? 'text-foreground' : 'text-foreground/70'
                      )}>
                        {getToolDisplayName(tool.id, tool.name)}
                      </div>

                      {/* Toggle */}
                      {!available ? (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="w-8 h-8 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                                <KeyRound className="w-3.5 h-3.5 text-muted-foreground/40" />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              <p>API Key required</p>
                              <p className="text-muted-foreground">Settings → API Keys</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                          <Switch
                            checked={enabled}
                            onCheckedChange={() => handleToolToggle(tool.id, tool)}
                          />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
