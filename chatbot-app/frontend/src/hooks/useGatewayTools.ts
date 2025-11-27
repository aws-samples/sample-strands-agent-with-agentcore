import { useState, useEffect, useCallback } from 'react';
import toolsConfig from '@/config/tools-config.json';
import { ENV_CONFIG } from '@/config/environment';
import { fetchAuthSession } from 'aws-amplify/auth';

export interface GatewayTool {
  id: string;
  name: string;
  description: string;
}

export interface GatewayTarget {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  enabled: boolean;
  isDynamic: boolean;
  tools: GatewayTool[];
  available?: boolean;  // Runtime availability from API
}

interface UseGatewayToolsReturn {
  gatewayTargets: GatewayTarget[];
  isLoading: boolean;
  refreshGatewayStatus: () => Promise<void>;
  toggleGatewayTarget: (targetId: string) => void;
  getEnabledToolIds: () => string[];  // Get all enabled tool IDs for backend
}

export const useGatewayTools = (): UseGatewayToolsReturn => {
  const [gatewayTargets, setGatewayTargets] = useState<GatewayTarget[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load Gateway targets from config file and restore enabled state from local-tool-store
  useEffect(() => {
    const loadGatewayTools = async () => {
      const targets = toolsConfig.gateway_targets as GatewayTarget[];

      try {
        // Get auth token
        const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
        try {
          const session = await fetchAuthSession()
          const token = session.tokens?.idToken?.toString()
          if (token) {
            authHeaders['Authorization'] = `Bearer ${token}`
          }
        } catch (error) {
          console.log('[useGatewayTools] No auth session available')
        }

        // Get saved enabled tools from BFF (matches with backend saved state)
        const response = await fetch('/api/tools', {
          method: 'GET',
          headers: authHeaders,
        });

        if (response.ok) {
          const data = await response.json();
          const allTools = [...(data.tools || []), ...(data.mcp_servers || [])];

          // Get enabled gateway tool IDs from saved tools
          const enabledGatewayToolIds = new Set(
            allTools
              .filter((tool: any) => tool.enabled && tool.id.startsWith('gateway_'))
              .map((tool: any) => tool.id)
          );

          // Build enabled map by target
          const enabledByTarget: Record<string, boolean> = {};

          targets.forEach(target => {
            // Check if ALL tools in this target are enabled
            const allToolsEnabled = target.tools.every(tool =>
              enabledGatewayToolIds.has(tool.id)
            );
            enabledByTarget[target.id] = allToolsEnabled;
          });

          const restoredTargets = targets.map(target => ({
            ...target,
            enabled: enabledByTarget[target.id] ?? target.enabled
          }));

          setGatewayTargets(restoredTargets);
        } else {
          setGatewayTargets(targets);
        }
      } catch (e) {
        console.error('[useGatewayTools] Failed to restore enabled state:', e);
        setGatewayTargets(targets);
      }
    };

    loadGatewayTools();
  }, []);

  // Check Gateway availability from backend
  const refreshGatewayStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      // Use BFF endpoint which proxies to AgentCore Runtime
      // This works both locally and in cloud deployment
      // No Authorization header needed - BFF uses IAM SigV4 internally
      const url = '/api/gateway-tools/list';

      console.log('[useGatewayTools] Checking Gateway status via BFF:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // 404 or 500 means BFF endpoint doesn't exist yet (not deployed)
        // This is expected during incremental deployment
        console.warn('[useGatewayTools] BFF endpoint not available:', response.status);
        setGatewayTargets(prev => prev.map(target => ({
          ...target,
          available: false
        })));
        return;
      }

      const data = await response.json();

      if (data.success && data.tools) {
        console.log('[useGatewayTools] Gateway tools from API:', data.tools.map((t: any) => t.id));

        // Mark targets as available if their tools are in the API response
        setGatewayTargets(prev => prev.map(target => {
          // Check if any of the target's tools are in the API response
          // Frontend config: gateway_wikipedia-search___wikipedia_search
          // Backend returns: wikipedia-search___wikipedia_search
          // So we need to strip the 'gateway_' prefix when matching
          const hasAvailableTools = target.tools.some(tool => {
            const toolIdWithoutPrefix = tool.id.replace(/^gateway_/, '');
            return data.tools.some((apiTool: any) =>
              apiTool.id === toolIdWithoutPrefix || apiTool.id === tool.id
            );
          });

          console.log(`[useGatewayTools] Target ${target.id}: available=${hasAvailableTools}`);

          return {
            ...target,
            available: hasAvailableTools
          };
        }));
      } else {
        // Gateway not available - mark all as unavailable
        setGatewayTargets(prev => prev.map(target => ({
          ...target,
          available: false
        })));
      }
    } catch (error) {
      console.error('Failed to check Gateway status:', error);
      // Mark all as unavailable on error
      setGatewayTargets(prev => prev.map(target => ({
        ...target,
        available: false
      })));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Toggle Gateway target (enables/disables all tools in target)
  const toggleGatewayTarget = useCallback((targetId: string, onChange?: (enabledIds: string[]) => void) => {
    setGatewayTargets(prev => {
      const updated = prev.map(target =>
        target.id === targetId
          ? { ...target, enabled: !target.enabled }
          : target
      );

      // Immediately call onChange callback with new enabled IDs
      if (onChange) {
        const enabledIds = updated
          .filter(t => t.enabled)
          .flatMap(t => t.tools.map(tool => tool.id));
        onChange(enabledIds);
      }

      return updated;
    });
  }, []);

  // Get list of all enabled tool IDs for passing to backend
  const getEnabledToolIds = useCallback((): string[] => {
    return gatewayTargets
      .filter(target => target.enabled)
      .flatMap(target => target.tools.map(tool => tool.id));
  }, [gatewayTargets]);

  // Check Gateway availability on mount
  useEffect(() => {
    refreshGatewayStatus();
  }, [refreshGatewayStatus]);

  return {
    gatewayTargets,
    isLoading,
    refreshGatewayStatus,
    toggleGatewayTarget,
    getEnabledToolIds
  };
};
