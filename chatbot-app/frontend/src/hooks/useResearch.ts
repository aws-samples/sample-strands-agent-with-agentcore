/**
 * useResearch Hook - Research workflow management with Canvas integration
 *
 * Manages state and logic for research agent workflow, following the same pattern as useComposer.
 * Handles interrupt-based plan approval, progress tracking, and result streaming.
 */

import { useState, useCallback, useRef } from 'react'

export interface ResearchPlan {
  plan: string
  planPreview?: string
}

export interface ResearchResult {
  title: string
  content: string
}

export interface ResearchState {
  isResearching: boolean
  progress: string
  plan: ResearchPlan | null
  showPlanConfirm: boolean
  resultParts: string[]
  completedResult: ResearchResult | null
  error: string | null
}

export interface ResearchInterrupt {
  id: string
  name: string
  reason?: {
    tool_name?: string
    plan?: string
    plan_preview?: string
    [key: string]: any
  }
}

export interface UseResearchOptions {
  sessionId: string | null
  respondToInterrupt: (interruptId: string, response: string) => void
  onResearchComplete?: (result: ResearchResult) => void
  onArtifactCreated?: (artifact: any) => void
}

export function useResearch({
  sessionId,
  respondToInterrupt,
  onResearchComplete,
  onArtifactCreated
}: UseResearchOptions) {
  const [state, setState] = useState<ResearchState>({
    isResearching: false,
    progress: '',
    plan: null,
    showPlanConfirm: false,
    resultParts: [],
    completedResult: null,
    error: null,
  })

  // Store interrupt ID for responding (ref to avoid re-renders)
  const currentInterruptIdRef = useRef<string | null>(null)

  /**
   * Handle interrupt from research agent (plan approval required)
   */
  const handleInterrupt = useCallback((interrupt: ResearchInterrupt) => {
    console.log('[useResearch] Interrupt received:', interrupt)

    if (interrupt.name === 'chatbot-research-approval' && interrupt.reason) {
      const plan = interrupt.reason.plan || ''
      const planPreview = interrupt.reason.plan_preview

      setState(prev => ({
        ...prev,
        isResearching: false,
        plan: { plan, planPreview },
        showPlanConfirm: true,
        error: null,
      }))

      currentInterruptIdRef.current = interrupt.id
    }
  }, [])

  /**
   * Confirm or reject research plan
   */
  const confirmPlanResponse = useCallback((approved: boolean) => {
    const interruptId = currentInterruptIdRef.current
    if (!interruptId) {
      console.error('[useResearch] No interrupt ID available')
      return
    }

    setState(prev => ({
      ...prev,
      showPlanConfirm: false,
      isResearching: approved,
      progress: approved ? 'Starting research...' : '',
      resultParts: [],
    }))

    // Send response to interrupt
    respondToInterrupt(interruptId, approved ? 'yes' : 'no')
    currentInterruptIdRef.current = null
  }, [respondToInterrupt])

  /**
   * Handle research_progress event from backend
   */
  const handleProgressEvent = useCallback((event: { stepNumber?: number; content?: string }) => {
    setState(prev => ({
      ...prev,
      isResearching: true,
      progress: event.content || `Step ${event.stepNumber || 1}`,
    }))
  }, [])

  /**
   * Handle streaming result event
   */
  const handleResultEvent = useCallback((result: string) => {
    setState(prev => ({
      ...prev,
      resultParts: [...prev.resultParts, result],
    }))
  }, [])

  /**
   * Handle research completion
   */
  const handleComplete = useCallback((result?: { title?: string; content?: string }) => {
    setState(prev => {
      const fullContent = prev.resultParts.join('')
      const completedResult: ResearchResult = {
        title: result?.title || 'Research Results',
        content: result?.content || fullContent,
      }

      if (onResearchComplete) {
        onResearchComplete(completedResult)
      }

      return {
        ...prev,
        completedResult,
        isResearching: false,
        progress: 'Research completed!',
      }
    })
  }, [onResearchComplete])

  /**
   * Reset research state
   */
  const reset = useCallback(() => {
    setState({
      isResearching: false,
      progress: '',
      plan: null,
      showPlanConfirm: false,
      resultParts: [],
      completedResult: null,
      error: null,
    })
    currentInterruptIdRef.current = null
  }, [])

  return {
    ...state,
    handleInterrupt,
    confirmPlanResponse,
    handleProgressEvent,
    handleResultEvent,
    handleComplete,
    reset,
  }
}
