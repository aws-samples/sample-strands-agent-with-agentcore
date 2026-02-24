import { FileText, Download, Trash2, Sparkles, Minimize2, LucideIcon } from "lucide-react"
import { Tool } from "@/types/chat"

export interface SlashCommand {
  name: string
  description: string
  icon: LucideIcon
  keywords?: string[]
  isToolCommand?: boolean
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/tool',
    description: 'Activate specific tools (comma-separated)',
    icon: Sparkles,
    keywords: ['tools', 'enable', 'activate', 'select'],
    isToolCommand: true
  },
  {
    name: '/compose',
    description: 'Create a new document',
    icon: FileText,
    keywords: ['document', 'write', 'create', 'draft']
  },
  {
    name: '/export',
    description: 'Export conversation to file',
    icon: Download,
    keywords: ['download', 'save', 'backup']
  },
  {
    name: '/clear',
    description: 'Start a new conversation',
    icon: Trash2,
    keywords: ['new', 'reset', 'fresh']
  },
  {
    name: '/compact',
    description: 'Summarize this session and continue in a new one',
    icon: Minimize2,
    keywords: ['summarize', 'compress', 'continue', 'context']
  },
]

export function filterCommands(query: string): SlashCommand[] {
  if (!query.startsWith('/')) return []

  const searchTerm = query.slice(1).toLowerCase()

  if (searchTerm === '') {
    return SLASH_COMMANDS
  }

  // If it's a /tool command with arguments, don't show other commands
  if (query.startsWith('/tool ')) {
    return []
  }

  return SLASH_COMMANDS.filter(cmd => {
    const nameMatch = cmd.name.slice(1).toLowerCase().includes(searchTerm)
    const descMatch = cmd.description.toLowerCase().includes(searchTerm)
    const keywordMatch = cmd.keywords?.some(k => k.includes(searchTerm))
    return nameMatch || descMatch || keywordMatch
  })
}

// Parse /tool command to extract tool names (comma-separated)
export function parseToolCommand(input: string): string[] | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/tool')) return null

  const afterCommand = trimmed.slice(5).trim() // Remove '/tool'
  if (!afterCommand) return []

  // Split by comma and trim each part
  return afterCommand.split(',').map(s => s.trim()).filter(s => s.length > 0)
}

// Get current typing tool name from /tool command (last incomplete item)
export function getCurrentToolQuery(input: string): string {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/tool')) return ''

  const afterCommand = trimmed.slice(5).trim()
  if (!afterCommand) return ''

  // Get the text after the last comma (current input)
  const parts = afterCommand.split(',')
  return parts[parts.length - 1].trim()
}

// Match tool names with fuzzy matching
export function matchTools(query: string, availableTools: Tool[]): Tool[] {
  const lowerQuery = query.toLowerCase()

  return availableTools
    .filter(tool => {
      // Skip A2A agents
      if (tool.id === 'agentcore_research-agent') {
        return false
      }

      const toolName = tool.name.toLowerCase()
      const toolId = tool.id.toLowerCase()

      // Exact or partial match in name or ID
      return toolName.includes(lowerQuery) || toolId.includes(lowerQuery)
    })
    .slice(0, 8) // Limit to top 8 matches
}

// Filter tool suggestions for autocomplete
export function getToolSuggestions(input: string, availableTools: Tool[]): Tool[] {
  const currentQuery = getCurrentToolQuery(input)
  if (!currentQuery) return []

  return matchTools(currentQuery, availableTools)
}
