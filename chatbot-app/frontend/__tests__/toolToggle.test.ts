import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToolToggle } from '@/hooks/useToolToggle'
import type { Tool } from '@/types/chat'

/**
 * Tests for Dynamic Tool Filtering (BFF/Frontend)
 *
 * The system allows users to enable/disable tools dynamically.
 * These tests verify:
 * - Tool grouping by type
 * - Individual tool toggle
 * - Category toggle (all tools in a group)
 * - Nested tool handling (for dynamic tool groups)
 * - Enabled count calculation
 */

describe('useToolToggle Hook', () => {
  const mockOnToggleTool = vi.fn()

  beforeEach(() => {
    mockOnToggleTool.mockClear()
  })

  // ============================================================
  // Basic Tool Grouping Tests
  // ============================================================

  describe('Tool Grouping', () => {
    it('should group tools by tool_type', () => {
      const tools: Tool[] = [
        { id: 'calculator', name: 'Calculator', description: 'Math', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        { id: 'web_search', name: 'Web Search', description: 'Search', icon: '', import_path: '', category: '', tool_type: 'local', enabled: true },
        { id: 'browser_agent', name: 'Browser', description: 'Browse', icon: '', import_path: '', category: '', tool_type: 'browser_automation' as any, enabled: false },
        { id: 'gateway_tool', name: 'Gateway', description: 'Gateway', icon: '', import_path: '', category: '', tool_type: 'gateway', enabled: true },
        { id: 'a2a_tool', name: 'A2A', description: 'A2A', icon: '', import_path: '', category: '', tool_type: 'runtime-a2a', enabled: true },
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: tools,
        onToggleTool: mockOnToggleTool
      }))

      expect(result.current.groupedTools.builtin).toHaveLength(1)
      expect(result.current.groupedTools.local).toHaveLength(1)
      expect(result.current.groupedTools.browser_automation).toHaveLength(1)
      expect(result.current.groupedTools.gateway).toHaveLength(1)
      expect(result.current.groupedTools['runtime-a2a']).toHaveLength(1)
    })

    it('should handle empty tool list', () => {
      const { result } = renderHook(() => useToolToggle({
        availableTools: [],
        onToggleTool: mockOnToggleTool
      }))

      expect(result.current.groupedTools.builtin).toHaveLength(0)
      expect(result.current.groupedTools.local).toHaveLength(0)
      expect(result.current.totalCount).toBe(0)
      expect(result.current.enabledCount).toBe(0)
    })

    it('should handle tools with unknown type gracefully', () => {
      const tools: Tool[] = [
        { id: 'tool1', name: 'Tool 1', description: 'Desc', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        { id: 'tool2', name: 'Tool 2', description: 'Desc', icon: '', import_path: '', category: '', tool_type: 'unknown_type' as any, enabled: true },
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: tools,
        onToggleTool: mockOnToggleTool
      }))

      // Unknown type tool should not appear in any group
      expect(result.current.groupedTools.builtin).toHaveLength(1)
      // Total count should still include it for enabled calculation
    })
  })

  // ============================================================
  // Enabled Count Calculation Tests
  // ============================================================

  describe('Enabled Count Calculation', () => {
    it('should count enabled and total tools correctly', () => {
      const tools: Tool[] = [
        { id: 'tool1', name: 'Tool 1', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        { id: 'tool2', name: 'Tool 2', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        { id: 'tool3', name: 'Tool 3', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: false },
        { id: 'tool4', name: 'Tool 4', description: 'D', icon: '', import_path: '', category: '', tool_type: 'local', enabled: false },
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: tools,
        onToggleTool: mockOnToggleTool
      }))

      expect(result.current.totalCount).toBe(4)
      expect(result.current.enabledCount).toBe(2)
    })

    it('should count all tools as enabled when all are enabled', () => {
      const tools: Tool[] = [
        { id: 'tool1', name: 'Tool 1', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        { id: 'tool2', name: 'Tool 2', description: 'D', icon: '', import_path: '', category: '', tool_type: 'local', enabled: true },
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: tools,
        onToggleTool: mockOnToggleTool
      }))

      expect(result.current.enabledCount).toBe(2)
      expect(result.current.totalCount).toBe(2)
    })

    it('should count zero enabled when all disabled', () => {
      const tools: Tool[] = [
        { id: 'tool1', name: 'Tool 1', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: false },
        { id: 'tool2', name: 'Tool 2', description: 'D', icon: '', import_path: '', category: '', tool_type: 'local', enabled: false },
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: tools,
        onToggleTool: mockOnToggleTool
      }))

      expect(result.current.enabledCount).toBe(0)
      expect(result.current.totalCount).toBe(2)
    })
  })

  // ============================================================
  // Category Toggle Tests
  // ============================================================

  describe('Category Toggle', () => {
    it('should toggle all tools in a category', () => {
      const tools: Tool[] = [
        { id: 'builtin1', name: 'Builtin 1', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        { id: 'builtin2', name: 'Builtin 2', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        { id: 'local1', name: 'Local 1', description: 'D', icon: '', import_path: '', category: '', tool_type: 'local', enabled: false },
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: tools,
        onToggleTool: mockOnToggleTool
      }))

      act(() => {
        result.current.toggleCategory('builtin')
      })

      // When all are enabled, toggling should call onToggleTool for each to disable
      expect(mockOnToggleTool).toHaveBeenCalledWith('builtin1')
      expect(mockOnToggleTool).toHaveBeenCalledWith('builtin2')
    })

    it('should check if all tools in category are enabled', () => {
      const tools: Tool[] = [
        { id: 'builtin1', name: 'Builtin 1', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        { id: 'builtin2', name: 'Builtin 2', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        { id: 'local1', name: 'Local 1', description: 'D', icon: '', import_path: '', category: '', tool_type: 'local', enabled: false },
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: tools,
        onToggleTool: mockOnToggleTool
      }))

      expect(result.current.areAllEnabled('builtin')).toBe(true)
      expect(result.current.areAllEnabled('local')).toBe(false)
    })

    it('should return true for empty category', () => {
      const tools: Tool[] = [
        { id: 'builtin1', name: 'Builtin 1', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: tools,
        onToggleTool: mockOnToggleTool
      }))

      // Empty category should return true (vacuously true)
      expect(result.current.areAllEnabled('gateway')).toBe(true)
    })
  })

  // ============================================================
  // Nested/Dynamic Tool Tests
  // ============================================================

  describe('Nested/Dynamic Tools', () => {
    it('should count nested tools in dynamic groups', () => {
      const tools: Tool[] = [
        { id: 'regular', name: 'Regular', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        {
          id: 'dynamic_group',
          name: 'Dynamic Group',
          description: 'D',
          icon: '',
          import_path: '',
          category: '',
          tool_type: 'gateway',
          enabled: true,
          isDynamic: true,
          tools: [
            { id: 'nested1', name: 'Nested 1', enabled: true },
            { id: 'nested2', name: 'Nested 2', enabled: false },
            { id: 'nested3', name: 'Nested 3', enabled: true },
          ]
        } as any,
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: tools,
        onToggleTool: mockOnToggleTool
      }))

      // 1 regular + 3 nested = 4 total, 1 regular + 2 nested enabled = 3 enabled
      expect(result.current.totalCount).toBe(4)
      expect(result.current.enabledCount).toBe(3)
    })

    it('should toggle nested tools in dynamic groups', () => {
      const tools: Tool[] = [
        {
          id: 'dynamic_group',
          name: 'Dynamic Group',
          description: 'D',
          icon: '',
          import_path: '',
          category: '',
          tool_type: 'gateway',
          enabled: true,
          isDynamic: true,
          tools: [
            { id: 'nested1', name: 'Nested 1', enabled: true },
            { id: 'nested2', name: 'Nested 2', enabled: true },
          ]
        } as any,
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: tools,
        onToggleTool: mockOnToggleTool
      }))

      act(() => {
        result.current.toggleCategory('gateway')
      })

      // Should toggle nested tools, not the parent
      expect(mockOnToggleTool).toHaveBeenCalledWith('nested1')
      expect(mockOnToggleTool).toHaveBeenCalledWith('nested2')
    })

    it('should check areAllEnabled for nested tools correctly', () => {
      const toolsAllEnabled: Tool[] = [
        {
          id: 'dynamic_group',
          name: 'Dynamic Group',
          description: 'D',
          icon: '',
          import_path: '',
          category: '',
          tool_type: 'gateway',
          enabled: true,
          isDynamic: true,
          tools: [
            { id: 'nested1', name: 'Nested 1', enabled: true },
            { id: 'nested2', name: 'Nested 2', enabled: true },
          ]
        } as any,
      ]

      const toolsPartialEnabled: Tool[] = [
        {
          id: 'dynamic_group',
          name: 'Dynamic Group',
          description: 'D',
          icon: '',
          import_path: '',
          category: '',
          tool_type: 'gateway',
          enabled: true,
          isDynamic: true,
          tools: [
            { id: 'nested1', name: 'Nested 1', enabled: true },
            { id: 'nested2', name: 'Nested 2', enabled: false },
          ]
        } as any,
      ]

      const { result: result1 } = renderHook(() => useToolToggle({
        availableTools: toolsAllEnabled,
        onToggleTool: mockOnToggleTool
      }))

      const { result: result2 } = renderHook(() => useToolToggle({
        availableTools: toolsPartialEnabled,
        onToggleTool: mockOnToggleTool
      }))

      expect(result1.current.areAllEnabled('gateway')).toBe(true)
      expect(result2.current.areAllEnabled('gateway')).toBe(false)
    })
  })

  // ============================================================
  // Tool Filtering Scenarios
  // ============================================================

  describe('Tool Filtering Scenarios', () => {
    it('should handle mixed enabled/disabled tools for agent request', () => {
      const tools: Tool[] = [
        { id: 'calculator', name: 'Calculator', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        { id: 'code_interpreter', name: 'Code Interpreter', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: false },
        { id: 'web_search', name: 'Web Search', description: 'D', icon: '', import_path: '', category: '', tool_type: 'local', enabled: true },
        { id: 'research_agent', name: 'Research', description: 'D', icon: '', import_path: '', category: '', tool_type: 'runtime-a2a', enabled: true },
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: tools,
        onToggleTool: mockOnToggleTool
      }))

      // Simulate extracting enabled tool IDs (as BFF would do)
      const enabledToolIds = tools.filter(t => t.enabled).map(t => t.id)

      expect(enabledToolIds).toContain('calculator')
      expect(enabledToolIds).not.toContain('code_interpreter')
      expect(enabledToolIds).toContain('web_search')
      expect(enabledToolIds).toContain('research_agent')
      expect(enabledToolIds).toHaveLength(3)

      // Hook should report same counts
      expect(result.current.enabledCount).toBe(3)
      expect(result.current.totalCount).toBe(4)
    })

    it('should handle all tools disabled scenario', () => {
      const tools: Tool[] = [
        { id: 'tool1', name: 'Tool 1', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: false },
        { id: 'tool2', name: 'Tool 2', description: 'D', icon: '', import_path: '', category: '', tool_type: 'local', enabled: false },
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: tools,
        onToggleTool: mockOnToggleTool
      }))

      const enabledToolIds = tools.filter(t => t.enabled).map(t => t.id)

      expect(enabledToolIds).toHaveLength(0)
      expect(result.current.enabledCount).toBe(0)
    })

    it('should handle tool filtering for specific use case (code mode)', () => {
      // Simulate a "code mode" preset that enables only coding tools
      const codeTools: Tool[] = [
        { id: 'code_interpreter', name: 'Code Interpreter', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        { id: 'diagram_tool', name: 'Diagram', description: 'D', icon: '', import_path: '', category: '', tool_type: 'builtin', enabled: true },
        { id: 'web_search', name: 'Web Search', description: 'D', icon: '', import_path: '', category: '', tool_type: 'local', enabled: false },
        { id: 'research_agent', name: 'Research', description: 'D', icon: '', import_path: '', category: '', tool_type: 'runtime-a2a', enabled: false },
      ]

      const { result } = renderHook(() => useToolToggle({
        availableTools: codeTools,
        onToggleTool: mockOnToggleTool
      }))

      expect(result.current.areAllEnabled('builtin')).toBe(true)
      expect(result.current.areAllEnabled('local')).toBe(false)
      expect(result.current.areAllEnabled('runtime-a2a')).toBe(false)
    })
  })
})
