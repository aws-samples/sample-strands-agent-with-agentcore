import { useState, useMemo, useEffect, useCallback } from 'react'

export interface ResearchExecutionData {
  query: string
  result: string
  status: 'idle' | 'searching' | 'analyzing' | 'generating' | 'complete' | 'error' | 'declined'
  agentName: string
}

export interface BrowserExecutionData {
  query: string
  result: string
  status: 'idle' | 'running' | 'complete' | 'error'
  agentName: string
}

interface MessageGroup {
  type: 'user' | 'assistant_turn'
  messages: Array<{
    toolExecutions?: Array<{
      id: string
      toolName: string
      toolInput?: Record<string, any>
      toolResult?: string
      streamingResponse?: string
      isComplete?: boolean
      isCancelled?: boolean
    }>
  }>
}

export function useAgentExecutions(groupedMessages: MessageGroup[]) {
  const [researchData, setResearchData] = useState<Map<string, ResearchExecutionData>>(new Map())
  const [browserData, setBrowserData] = useState<Map<string, BrowserExecutionData>>(new Map())
  const [isBrowserModalOpen, setIsBrowserModalOpen] = useState(false)
  const [activeBrowserId, setActiveBrowserId] = useState<string | null>(null)

  const { computedResearchData, computedBrowserData } = useMemo(() => {
    const newResearchData = new Map<string, ResearchExecutionData>()
    const newBrowserData = new Map<string, BrowserExecutionData>()

    for (const group of groupedMessages) {
      if (group.type === 'assistant_turn') {
        for (const message of group.messages) {
          const toolExecutions = message.toolExecutions
          if (!toolExecutions || toolExecutions.length === 0) continue

          for (const execution of toolExecutions) {
            if (execution.toolName === 'research_agent') {
              const executionId = execution.id
              const query = execution.toolInput?.plan || "Research Task"

              if (!execution.isComplete) {
                newResearchData.set(executionId, {
                  query,
                  result: execution.streamingResponse || '',
                  status: execution.streamingResponse ? 'generating' : 'searching',
                  agentName: 'Research Agent'
                })
              } else if (execution.toolResult) {
                const resultText = execution.toolResult.toLowerCase()
                const isError = execution.isCancelled || resultText.includes('error:') || resultText.includes('failed:')
                const isDeclined = resultText === 'user declined to proceed with research' ||
                                  resultText === 'user declined to proceed with browser automation'

                let status: 'complete' | 'error' | 'declined' = 'complete'
                if (isError) status = 'error'
                else if (isDeclined) status = 'declined'

                newResearchData.set(executionId, {
                  query,
                  result: execution.toolResult,
                  status,
                  agentName: 'Research Agent'
                })
              }
            } else if (execution.toolName === 'browser_use_agent') {
              const executionId = execution.id
              const query = execution.toolInput?.task || "Browser Task"

              if (!execution.isComplete) {
                newBrowserData.set(executionId, {
                  query,
                  result: execution.streamingResponse || '',
                  status: 'running',
                  agentName: 'Browser Use Agent'
                })
              } else if (execution.toolResult) {
                const resultText = execution.toolResult.toLowerCase()
                const isError = execution.isCancelled ||
                  resultText.includes('error:') ||
                  resultText.includes('failed:') ||
                  resultText.includes('browser automation failed')

                newBrowserData.set(executionId, {
                  query,
                  result: execution.toolResult,
                  status: isError ? 'error' : 'complete',
                  agentName: 'Browser Use Agent'
                })
              }
            }
          }
        }
      }
    }

    return { computedResearchData: newResearchData, computedBrowserData: newBrowserData }
  }, [groupedMessages])

  useEffect(() => {
    setResearchData(prev => {
      if (computedResearchData.size !== prev.size ||
          Array.from(computedResearchData.entries()).some(([id, data]) => {
            const existing = prev.get(id)
            return !existing || existing.result !== data.result || existing.status !== data.status
          })) {
        return computedResearchData
      }
      return prev
    })
  }, [computedResearchData])

  useEffect(() => {
    setBrowserData(prev => {
      if (computedBrowserData.size !== prev.size ||
          Array.from(computedBrowserData.entries()).some(([id, data]) => {
            const existing = prev.get(id)
            return !existing || existing.result !== data.result || existing.status !== data.status
          })) {
        return computedBrowserData
      }
      return prev
    })
  }, [computedBrowserData])

  const handleBrowserClick = useCallback((executionId: string) => {
    setActiveBrowserId(executionId)
    setIsBrowserModalOpen(true)
  }, [])

  const closeBrowserModal = useCallback(() => {
    setIsBrowserModalOpen(false)
    setActiveBrowserId(null)
  }, [])

  return {
    researchData,
    browserData,
    isBrowserModalOpen,
    activeBrowserId,
    handleBrowserClick,
    closeBrowserModal,
  }
}
