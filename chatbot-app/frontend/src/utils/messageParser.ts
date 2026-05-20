/**
 * Message parsing utilities for AgentCore Memory session loading
 */

import { ToolExecution } from '@/types/chat'
import { extractBlobImages, extractToolResultImages, extractToolResultText } from './imageExtractor'

/**
 * Build toolUse and toolResult maps from messages
 */
export function buildToolMaps(messages: any[]): {
  toolUseMap: Map<string, any>
  toolResultMap: Map<string, any>
} {
  const toolUseMap = new Map<string, any>()
  const toolResultMap = new Map<string, any>()

  messages.forEach((msg: any) => {
    if (Array.isArray(msg.content)) {
      msg.content.forEach((item: any) => {
        if (item.toolUse) {
          toolUseMap.set(item.toolUse.toolUseId, item.toolUse)
        } else if (item.toolResult) {
          toolResultMap.set(item.toolResult.toolUseId, item.toolResult)
        }
      })
    }
  })

  return { toolUseMap, toolResultMap }
}

/**
 * Create tool execution from toolUse and toolResult with images
 */
export function createToolExecution(
  toolUse: any,
  toolResult: any | null,
  msg: any
): ToolExecution {
  const toolUseId = toolUse.toolUseId

  // Extract text from toolResult
  let toolResultString = toolResult ? extractToolResultText(toolResult) : ''

  // Check if images should be hidden (e.g., preview_word_page)
  const hideImageInChat = toolResult?.metadata?.hideImageInChat === true

  // Extract images from toolResult.content (unless hideImageInChat is set)
  const images = hideImageInChat ? [] : extractToolResultImages(toolResult)

  // DDB stores raw Strands messages where skill tools appear as skill_executor.
  // SSE unwraps this at streaming time, but on session reload we must do it here.
  let toolName = toolUse.name
  let toolInput = toolUse.input
  if (toolUse.name === 'skill_executor' && toolUse.input?.tool_name) {
    toolName = toolUse.input.tool_name
    toolInput = toolUse.input.tool_input ?? toolUse.input
  }

  const execution: ToolExecution = {
    id: toolUseId,
    toolName,
    toolInput,
    reasoning: [],
    toolResult: toolResultString,
    isComplete: !!toolResult,
    isExpanded: false
  }

  // Only add images if array is not empty
  if (images.length > 0) {
    execution.images = images
  }

  // Restore code agent terminal log from tool_result metadata (persisted by backend)
  if (toolResult?.metadata?.codeSteps && Array.isArray(toolResult.metadata.codeSteps)) {
    execution.codeSteps = toolResult.metadata.codeSteps
  }

  return execution
}
