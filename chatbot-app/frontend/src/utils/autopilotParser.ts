/**
 * Autopilot Message Parser
 *
 * Parses autopilot-related markers from messages for session restore.
 * Handles:
 *   - [USER_QUERY] actual_query - original user query (legacy)
 *   - [DIRECTIVE:1] (User: query) task - step 1 with embedded user query
 *   - [DIRECTIVE:N] task - step N directive
 *   - [AUTOPILOT:summary] prompt_text - final summary
 *   - [AUTOPILOT:direct] prompt_text - direct response (no tools)
 */

export type AutopilotType = 'directive' | 'summary' | 'direct'

export interface AutopilotParseResult {
  /** Cleaned text with markers removed */
  cleanedText: string
  /** Whether this is an autopilot message (directive, summary, or direct) */
  isAutopilot: boolean
  /** Type of autopilot message */
  autopilotType?: AutopilotType
  /** Directive step number (for directive type) */
  directiveStep?: number
  /** Original user query extracted from [DIRECTIVE:1] (User: ...) */
  originalUserQuery?: string
  /** Whether this is a legacy [USER_QUERY] marker */
  isLegacyUserQuery: boolean
}

/**
 * Parse autopilot markers from a user message text
 *
 * @param text - Raw message text that may contain autopilot markers
 * @returns Parsed result with cleaned text and autopilot metadata
 */
export function parseAutopilotMessage(text: string): AutopilotParseResult {
  let cleanedText = text
  let isAutopilot = false
  let autopilotType: AutopilotType | undefined
  let directiveStep: number | undefined
  let originalUserQuery: string | undefined
  let isLegacyUserQuery = false

  // Check for legacy [USER_QUERY] marker
  const userQueryMatch = cleanedText.match(/^\[USER_QUERY\]\s*([\s\S]*)$/)
  if (userQueryMatch) {
    isLegacyUserQuery = true
    cleanedText = userQueryMatch[1]
    return {
      cleanedText,
      isAutopilot: false,
      isLegacyUserQuery
    }
  }

  // Check for directive marker
  // Format: [DIRECTIVE:step_number] (User: original_query) prompt_text  (for step 1)
  // Format: [DIRECTIVE:step_number] prompt_text  (for step 2+)
  if (cleanedText.startsWith('[DIRECTIVE:')) {
    const directiveMatch = cleanedText.match(/^\[DIRECTIVE:(\d+)\]\s*([\s\S]*)$/)
    if (directiveMatch) {
      isAutopilot = true
      directiveStep = parseInt(directiveMatch[1], 10)
      autopilotType = 'directive'
      let directiveContent = directiveMatch[2]

      // For step 1, extract original user query if present
      // Format: (User: original_query) directive_text
      if (directiveStep === 1) {
        const userQueryInDirective = directiveContent.match(/^\(User:\s*([\s\S]*?)\)\s*([\s\S]*)$/)
        if (userQueryInDirective) {
          originalUserQuery = userQueryInDirective[1]
          directiveContent = userQueryInDirective[2]
        }
      }

      cleanedText = directiveContent
    }
  }
  // Check for autopilot markers (summary or direct)
  // Format: [AUTOPILOT:type] prompt_text
  else if (cleanedText.startsWith('[AUTOPILOT:')) {
    const autopilotMatch = cleanedText.match(/^\[AUTOPILOT:(summary|direct)\]\s*([\s\S]*)$/)
    if (autopilotMatch) {
      isAutopilot = true
      autopilotType = autopilotMatch[1] as 'summary' | 'direct'
      const content = autopilotMatch[2]

      // For direct type, the content IS the original user query
      if (autopilotType === 'direct') {
        originalUserQuery = content
        cleanedText = 'Responding directly...'
      } else {
        cleanedText = content
      }
    }
  }
  // Legacy: Check for [SUMMARY] marker (for backwards compatibility)
  else if (cleanedText.startsWith('[SUMMARY]')) {
    isAutopilot = true
    autopilotType = 'summary'
    cleanedText = cleanedText.replace(/^\[SUMMARY]\s*/, '')
  }

  return {
    cleanedText,
    isAutopilot,
    autopilotType,
    directiveStep,
    originalUserQuery,
    isLegacyUserQuery
  }
}

/**
 * Get display label for autopilot badge
 *
 * @param autopilotType - Type of autopilot message
 * @param directiveStep - Step number (for directive type)
 * @returns Badge label text
 */
export function getAutopilotBadgeLabel(
  autopilotType?: AutopilotType,
  directiveStep?: number
): string {
  switch (autopilotType) {
    case 'summary':
      return 'Summary'
    case 'direct':
      return 'Direct'
    case 'directive':
    default:
      return `Step ${directiveStep || '?'}`
  }
}

/**
 * Check if text contains any autopilot marker
 *
 * @param text - Text to check
 * @returns True if text starts with an autopilot marker
 */
export function hasAutopilotMarker(text: string): boolean {
  return (
    text.startsWith('[USER_QUERY]') ||
    text.startsWith('[DIRECTIVE:') ||
    text.startsWith('[AUTOPILOT:') ||
    text.startsWith('[SUMMARY]')
  )
}
