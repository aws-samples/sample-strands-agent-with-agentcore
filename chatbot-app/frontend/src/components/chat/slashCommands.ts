import { Download, Trash2, Minimize2, LucideIcon } from "lucide-react"

export interface SlashCommand {
  name: string
  description: string
  icon: LucideIcon
  keywords?: string[]
}

export const SLASH_COMMANDS: SlashCommand[] = [
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

  return SLASH_COMMANDS.filter(cmd => {
    const nameMatch = cmd.name.slice(1).toLowerCase().includes(searchTerm)
    const descMatch = cmd.description.toLowerCase().includes(searchTerm)
    const keywordMatch = cmd.keywords?.some(k => k.includes(searchTerm))
    return nameMatch || descMatch || keywordMatch
  })
}
