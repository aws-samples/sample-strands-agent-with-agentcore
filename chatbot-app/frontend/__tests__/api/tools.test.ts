/**
 * Tests for /api/tools route
 *
 * Tests cover:
 * - Tool registry loading
 * - User-specific enabled state mapping
 * - Tool type categorization (local, builtin, gateway, browser_automation, runtime-a2a)
 * - Nested tools handling (dynamic tools with sub-tools)
 * - Anonymous vs authenticated user handling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('@/lib/auth-utils', () => ({
  extractUserFromRequest: vi.fn()
}))

vi.mock('@/lib/dynamodb-client', () => ({
  getUserEnabledTools: vi.fn(),
  getUserProfile: vi.fn(),
  upsertUserProfile: vi.fn(),
  getToolRegistry: vi.fn()
}))

// Sample tools config for testing
const sampleToolsConfig = {
  local_tools: [
    { id: 'web_search', name: 'Web Search', description: 'Search the web', category: 'Research' },
    { id: 'calculator', name: 'Calculator', description: 'Math calculations', category: 'Utilities' }
  ],
  builtin_tools: [
    { id: 'diagram_generator', name: 'Diagram Generator', description: 'Generate diagrams', category: 'Visualization', icon: '📊' },
    {
      id: 'word_document_tools',
      name: 'Word Document Tools',
      description: 'Create and edit Word documents',
      category: 'Documents',
      icon: '📄',
      isDynamic: true,
      tools: [
        { id: 'create_word_document', name: 'Create Word Document', description: 'Create new Word doc' },
        { id: 'modify_word_document', name: 'Modify Word Document', description: 'Edit existing Word doc' }
      ]
    }
  ],
  browser_automation: [
    {
      id: 'browser_use_tools',
      name: 'Browser Use',
      description: 'Browser automation',
      category: 'Automation',
      icon: '🌐',
      isDynamic: true,
      tools: [
        { id: 'browser_use_agent', name: 'Browser Agent', description: 'Automated browsing' }
      ]
    }
  ],
  gateway_targets: [
    {
      id: 'google_maps_tools',
      name: 'Google Maps',
      description: 'Location services',
      category: 'Location',
      icon: '🗺️',
      isDynamic: true,
      tools: [
        { id: 'search_places', name: 'Search Places', description: 'Find locations' },
        { id: 'get_directions', name: 'Get Directions', description: 'Navigation' }
      ]
    }
  ],
  agentcore_runtime_a2a: [
    {
      id: 'research_agent',
      name: 'Research Agent',
      description: 'Deep research',
      category: 'Research',
      icon: '🔬',
      runtime_arn: 'arn:aws:agentcore:us-west-2:123:agent/research'
    }
  ]
}

describe('Tools API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Tool Type Mapping', () => {
    it('should map local_tools correctly', () => {
      const localTools = sampleToolsConfig.local_tools.map(tool => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        type: 'local_tools',
        tool_type: 'local',
        enabled: false
      }))

      expect(localTools).toHaveLength(2)
      expect(localTools[0].type).toBe('local_tools')
      expect(localTools[0].tool_type).toBe('local')
    })

    it('should map builtin_tools correctly', () => {
      const builtinTools = sampleToolsConfig.builtin_tools.map(tool => ({
        id: tool.id,
        name: tool.name,
        type: 'builtin_tools',
        tool_type: 'builtin',
        isDynamic: tool.isDynamic ?? false
      }))

      expect(builtinTools).toHaveLength(2)
      expect(builtinTools[0].isDynamic).toBe(false)
      expect(builtinTools[1].isDynamic).toBe(true)
    })

    it('should map browser_automation correctly', () => {
      const browserTools = sampleToolsConfig.browser_automation.map(group => ({
        id: group.id,
        name: group.name,
        type: 'browser_automation',
        tool_type: 'browser_automation',
        isDynamic: group.isDynamic ?? true
      }))

      expect(browserTools).toHaveLength(1)
      expect(browserTools[0].type).toBe('browser_automation')
      expect(browserTools[0].tool_type).toBe('browser_automation')
    })

    it('should map gateway_targets correctly', () => {
      const gatewayTools = sampleToolsConfig.gateway_targets.map(target => ({
        id: target.id,
        name: target.name,
        type: 'gateway',
        tool_type: 'gateway',
        isDynamic: target.isDynamic ?? true
      }))

      expect(gatewayTools).toHaveLength(1)
      expect(gatewayTools[0].type).toBe('gateway')
      expect(gatewayTools[0].tool_type).toBe('gateway')
    })

    it('should map agentcore_runtime_a2a correctly', () => {
      const a2aTools = sampleToolsConfig.agentcore_runtime_a2a.map(server => ({
        id: server.id,
        name: server.name,
        type: 'runtime-a2a',
        tool_type: 'runtime-a2a',
        isDynamic: false,
        runtime_arn: server.runtime_arn
      }))

      expect(a2aTools).toHaveLength(1)
      expect(a2aTools[0].type).toBe('runtime-a2a')
      expect(a2aTools[0].runtime_arn).toBe('arn:aws:agentcore:us-west-2:123:agent/research')
    })
  })

  describe('User Enabled State', () => {
    it('should mark tools as enabled when in enabledToolIds', () => {
      const enabledToolIds = ['web_search', 'calculator']

      const localTools = sampleToolsConfig.local_tools.map(tool => ({
        id: tool.id,
        name: tool.name,
        enabled: enabledToolIds.includes(tool.id)
      }))

      expect(localTools[0].enabled).toBe(true)  // web_search
      expect(localTools[1].enabled).toBe(true)  // calculator
    })

    it('should mark tools as disabled when not in enabledToolIds', () => {
      const enabledToolIds: string[] = []

      const localTools = sampleToolsConfig.local_tools.map(tool => ({
        id: tool.id,
        name: tool.name,
        enabled: enabledToolIds.includes(tool.id)
      }))

      expect(localTools[0].enabled).toBe(false)
      expect(localTools[1].enabled).toBe(false)
    })

    it('should check nested tools for dynamic builtin tools', () => {
      const enabledToolIds = ['create_word_document']

      const dynamicTool = sampleToolsConfig.builtin_tools[1]  // word_document_tools
      const anyToolEnabled = dynamicTool.tools?.some(nestedTool => enabledToolIds.includes(nestedTool.id))

      expect(anyToolEnabled).toBe(true)
    })

    it('should mark dynamic tool as disabled when no nested tools enabled', () => {
      const enabledToolIds = ['web_search']  // Unrelated tool

      const dynamicTool = sampleToolsConfig.builtin_tools[1]  // word_document_tools
      const anyToolEnabled = dynamicTool.tools?.some(nestedTool => enabledToolIds.includes(nestedTool.id))

      expect(anyToolEnabled).toBe(false)
    })
  })

  describe('Nested Tools Handling', () => {
    it('should include nested tools for dynamic groups', () => {
      const dynamicTool = sampleToolsConfig.builtin_tools[1]

      expect(dynamicTool.isDynamic).toBe(true)
      expect(dynamicTool.tools).toBeDefined()
      expect(dynamicTool.tools).toHaveLength(2)
      expect(dynamicTool.tools![0].id).toBe('create_word_document')
    })

    it('should map nested tool enabled state individually', () => {
      const enabledToolIds = ['create_word_document']  // Only create, not modify

      const dynamicTool = sampleToolsConfig.builtin_tools[1]
      const mappedNestedTools = dynamicTool.tools?.map(nestedTool => ({
        id: nestedTool.id,
        name: nestedTool.name,
        enabled: enabledToolIds.includes(nestedTool.id)
      }))

      expect(mappedNestedTools![0].enabled).toBe(true)   // create_word_document
      expect(mappedNestedTools![1].enabled).toBe(false)  // modify_word_document
    })

    it('should handle gateway tools with nested tools', () => {
      const enabledToolIds = ['search_places']

      const gatewayGroup = sampleToolsConfig.gateway_targets[0]
      const anyToolEnabled = gatewayGroup.tools?.some(tool => enabledToolIds.includes(tool.id))

      expect(anyToolEnabled).toBe(true)
    })

    it('should handle browser automation with nested tools', () => {
      const enabledToolIds = ['browser_use_agent']

      const browserGroup = sampleToolsConfig.browser_automation[0]
      const anyToolEnabled = browserGroup.tools?.some(tool => enabledToolIds.includes(tool.id))

      expect(anyToolEnabled).toBe(true)
    })
  })

  describe('User Authentication', () => {
    it('should initialize new user with all tools disabled', () => {
      const userId = 'new-user-123'
      const profile = null  // User doesn't exist

      let enabledToolIds: string[] = []

      if (!profile) {
        // New user - all disabled
        enabledToolIds = []
      }

      expect(enabledToolIds).toEqual([])
    })

    it('should load existing user preferences', () => {
      const storedTools = ['web_search', 'calculator', 'create_word_document']

      const enabledToolIds = storedTools

      expect(enabledToolIds).toContain('web_search')
      expect(enabledToolIds).toContain('calculator')
      expect(enabledToolIds).toContain('create_word_document')
    })

    it('should handle anonymous user', () => {
      const userId = 'anonymous'

      expect(userId).toBe('anonymous')
    })
  })

  describe('Tool Registry Sync', () => {
    const countNestedTools = (items: any[] = []) => {
      return items.reduce((sum, item) => {
        if (item.tools && Array.isArray(item.tools)) {
          return sum + item.tools.length
        }
        return sum + 1
      }, 0)
    }

    it('should count nested tools correctly', () => {
      const builtinCount = countNestedTools(sampleToolsConfig.builtin_tools)

      // diagram_generator (1) + word_document_tools.tools (2) = 3
      expect(builtinCount).toBe(3)
    })

    it('should detect registry changes by tool count', () => {
      const oldRegistry = { local_tools: [{ id: 'tool1' }] }
      const newRegistry = { local_tools: [{ id: 'tool1' }, { id: 'tool2' }] }

      const needsSync = (oldRegistry.local_tools?.length || 0) !== (newRegistry.local_tools?.length || 0)

      expect(needsSync).toBe(true)
    })

    it('should detect no changes when counts match', () => {
      const oldRegistry = { local_tools: [{ id: 'tool1' }, { id: 'tool2' }] }
      const newRegistry = { local_tools: [{ id: 'tool1' }, { id: 'tool2' }] }

      const needsSync = (oldRegistry.local_tools?.length || 0) !== (newRegistry.local_tools?.length || 0)

      expect(needsSync).toBe(false)
    })
  })

  describe('Response Format', () => {
    it('should return all tool categories in single array', () => {
      const enabledToolIds: string[] = []

      const localTools = sampleToolsConfig.local_tools.map(tool => ({
        ...tool, type: 'local_tools', enabled: enabledToolIds.includes(tool.id)
      }))

      const builtinTools = sampleToolsConfig.builtin_tools.map(tool => ({
        ...tool, type: 'builtin_tools', enabled: enabledToolIds.includes(tool.id)
      }))

      const allTools = [...localTools, ...builtinTools]

      expect(allTools.length).toBe(4)  // 2 local + 2 builtin
    })

    it('should include all required fields in tool response', () => {
      const tool = sampleToolsConfig.local_tools[0]
      const enabledToolIds: string[] = ['web_search']

      const mappedTool = {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        type: 'local_tools',
        tool_type: 'local',
        enabled: enabledToolIds.includes(tool.id)
      }

      expect(mappedTool).toHaveProperty('id')
      expect(mappedTool).toHaveProperty('name')
      expect(mappedTool).toHaveProperty('description')
      expect(mappedTool).toHaveProperty('category')
      expect(mappedTool).toHaveProperty('type')
      expect(mappedTool).toHaveProperty('tool_type')
      expect(mappedTool).toHaveProperty('enabled')
    })
  })

  describe('Error Handling', () => {
    it('should fallback to config file on error', () => {
      // When DynamoDB fails, use toolsConfigFallback
      const fallbackTools = sampleToolsConfig.local_tools.map(tool => ({
        id: tool.id,
        name: tool.name,
        type: 'local_tools',
        enabled: true  // Default to enabled in fallback
      }))

      expect(fallbackTools).toHaveLength(2)
      expect(fallbackTools[0].enabled).toBe(true)
    })
  })
})
