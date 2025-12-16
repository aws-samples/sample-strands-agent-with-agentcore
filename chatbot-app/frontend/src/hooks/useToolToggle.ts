import { useMemo } from 'react';
import { Tool } from '@/types/chat';

interface UseToolToggleProps {
  availableTools: Tool[];
  onToggleTool: (toolId: string) => void;
}

export function useToolToggle({ availableTools, onToggleTool }: UseToolToggleProps) {
  // Group tools by tool_type
  const groupedTools = useMemo(() => {
    const groups = {
      'local': [] as Tool[],
      'builtin': [] as Tool[],
      'browser_automation': [] as Tool[],
      'gateway': [] as Tool[],
      'runtime-a2a': [] as Tool[]
    };

    availableTools.forEach(tool => {
      const toolType = tool.tool_type;
      if (groups[toolType as keyof typeof groups]) {
        groups[toolType as keyof typeof groups].push(tool);
      }
    });

    return groups;
  }, [availableTools]);

  // Toggle all tools in a category (including nested tools in dynamic groups)
  const toggleCategory = (category: 'local' | 'builtin' | 'browser_automation' | 'gateway' | 'runtime-a2a') => {
    // Collect all tool IDs with their enabled status
    const allToolsWithStatus: Array<{ id: string; enabled: boolean }> = [];

    groupedTools[category].forEach(tool => {
      const isDynamic = (tool as any).isDynamic === true;
      const nestedTools = (tool as any).tools || [];

      if (isDynamic && nestedTools.length > 0) {
        // Add nested tools with their enabled status
        nestedTools.forEach((nestedTool: any) => {
          allToolsWithStatus.push({
            id: nestedTool.id,
            enabled: nestedTool.enabled
          });
        });
      } else {
        // Add top-level tool with its enabled status
        allToolsWithStatus.push({
          id: tool.id,
          enabled: tool.enabled
        });
      }
    });

    // Check if all tools are enabled
    const allEnabled = allToolsWithStatus.every(t => t.enabled);

    // Toggle all tools in the category
    allToolsWithStatus.forEach(({ id, enabled }) => {
      if (enabled === allEnabled) {
        onToggleTool(id);
      }
    });
  };

  // Check if all tools in a category are enabled
  const areAllEnabled = (category: 'local' | 'builtin' | 'browser_automation' | 'gateway' | 'runtime-a2a'): boolean => {
    let allEnabled = true;

    groupedTools[category].forEach(tool => {
      const isDynamic = (tool as any).isDynamic === true;
      const nestedTools = (tool as any).tools || [];

      if (isDynamic && nestedTools.length > 0) {
        // For dynamic tools, check nested tools' enabled status
        nestedTools.forEach((nt: any) => {
          if (!nt.enabled) {
            allEnabled = false;
          }
        });
      } else {
        // For regular tools, check tool's enabled status
        if (!tool.enabled) {
          allEnabled = false;
        }
      }
    });

    return allEnabled;
  };

  const enabledCount = availableTools.filter(tool => tool.enabled).length;
  const totalCount = availableTools.length;

  return {
    groupedTools,
    toggleCategory,
    areAllEnabled,
    enabledCount,
    totalCount,
  };
}
