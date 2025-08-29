import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Message, Tool, ToolExecution } from '@/types/chat'
import { ReasoningState, ChatSessionState, ChatUIState, ToolProgressState } from '@/types/events'
import { detectBackendUrl } from '@/utils/chat'
import { useStreamEvents } from './useStreamEvents'
import { useChatAPI } from './useChatAPI'
import { useToolEvents } from './useToolEvents'
import { getApiUrl } from '@/config/environment'
import API_CONFIG from '@/config/api'


interface UseChatReturn {
  messages: Message[]
  groupedMessages: Array<{
    type: 'user' | 'assistant_turn'
    messages: Message[]
    id: string
  }>
  inputMessage: string
  setInputMessage: (message: string) => void
  isConnected: boolean
  isTyping: boolean
  availableTools: Tool[]
  currentToolExecutions: ToolExecution[]
  currentReasoning: ReasoningState | null
  toolProgress: ToolProgressState[]
  showProgressPanel: boolean
  toggleProgressPanel: () => void
  sendMessage: (e: React.FormEvent, files?: File[]) => Promise<void>
  clearChat: () => Promise<void>
  toggleTool: (toolId: string) => Promise<void>
  refreshTools: () => Promise<void>
  sessionId: string | null
}

export const useChat = (): UseChatReturn => {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [backendUrl, setBackendUrl] = useState('http://localhost:8000')
  const [availableTools, setAvailableTools] = useState<Tool[]>([])
  
  const [sessionState, setSessionState] = useState<ChatSessionState>({
    reasoning: null,
    streaming: null,
    toolExecutions: [],
    toolProgress: []
  })
  
  const [uiState, setUIState] = useState<ChatUIState>({
    isConnected: true,
    isTyping: false,
    showProgressPanel: false
  })
  
  const currentToolExecutionsRef = useRef<ToolExecution[]>([])
  const currentTurnIdRef = useRef<string | null>(null)

  useEffect(() => {
    currentToolExecutionsRef.current = sessionState.toolExecutions
  }, [sessionState.toolExecutions])

  // Auto-detect backend URL
  useEffect(() => {
    const initBackend = async () => {
      const { url, connected } = await detectBackendUrl()
      setBackendUrl(url)
      setUIState(prev => ({ ...prev, isConnected: connected }))
    }
    initBackend()
  }, [])

  // Clear progress states on page refresh/reload
  useEffect(() => {
    const isPageRefresh = typeof window !== 'undefined' && 
      (window.performance?.navigation?.type === 1 || 
       (window.performance?.getEntriesByType('navigation')?.[0] as any)?.type === 'reload');
    
    if (isPageRefresh) {
      setSessionState(prev => ({ 
        ...prev, 
        toolProgress: [] 
      }));
    }
  }, []);

  const handleLegacyEvent = useCallback((data: any) => {
    switch (data.type) {
      case 'init':
      case 'thinking':
        setUIState(prev => ({ ...prev, isTyping: true }))
        break
      case 'complete':
        setUIState(prev => ({ ...prev, isTyping: false }))
        if (data.message) {
          setMessages(prev => [...prev, {
            id: Date.now(),
            text: data.message,
            sender: 'bot',
            timestamp: new Date().toLocaleTimeString(),
            images: data.images || []
          }])
        }
        break
      case 'error':
        setUIState(prev => ({ ...prev, isTyping: false }))
        setMessages(prev => [...prev, {
          id: Date.now(),
          text: data.message || 'An error occurred',
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString()
        }])
        break
    }
  }, [])

  // Initialize stream events hook
  const { handleStreamEvent } = useStreamEvents({
    sessionState,
    setSessionState,
    setMessages,
    setUIState,
    currentToolExecutionsRef,
    currentTurnIdRef,
    availableTools
  })

  // Initialize chat API hook
  const { loadTools, toggleTool: apiToggleTool, clearChat: apiClearChat, sendMessage: apiSendMessage, cleanup, sessionId } = useChatAPI({
    backendUrl,
    setUIState,
    setMessages,
    setAvailableTools,
    handleStreamEvent,
    handleLegacyEvent
  })

  // Initialize tool events hook for real-time progress
  // Remove backendUrl dependency - let useToolEvents handle URL via getApiUrl()
  const { progressStates, clearProgress, clearAnalysis } = useToolEvents('', sessionId || undefined)

  // Clear progress states and analysis data on page load/refresh
  useEffect(() => {
    // Force clear progress and analysis data to prevent stale data after refresh
    const handlePageLoad = () => {
      clearProgress()
      clearAnalysis()
      // Also clear session state progress
      setSessionState(prev => ({
        ...prev,
        toolProgress: []
      }))
    }
    
    handlePageLoad()
    
    // Also clear on window focus (when user returns to tab)
    const handleFocus = () => {
      clearProgress()
      clearAnalysis()
    }
    
    // Clear stored progress events before page unload
    const handleBeforeUnload = () => {
      if (sessionId) {
        navigator.sendBeacon(getApiUrl(`stream/tools/clear?session_id=${sessionId}`), '')
      }
    }
    
    window.addEventListener('focus', handleFocus)
    window.addEventListener('beforeunload', handleBeforeUnload)
    
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [clearProgress, clearAnalysis, setSessionState, backendUrl, sessionId])

  // Function to clear stored progress events
  const clearProgressEvents = useCallback(async () => {
    if (!sessionId) return
    
    try {
      const response = await fetch(getApiUrl(`stream/tools/clear?session_id=${sessionId}`), {
        method: 'POST',
      })
      
      if (response.ok) {
        console.log('Progress events cleared for session:', sessionId)
      }
    } catch (error) {
      console.warn('Failed to clear progress events:', error)
    }
  }, [sessionId])

  // Clear progress events and load tools when backend is ready
  useEffect(() => {
    if (uiState.isConnected) {
      const timeoutId = setTimeout(async () => {
        // Clear stored progress events from previous sessions
        await clearProgressEvents()
        // Then load tools
        await loadTools()
      }, 1000)
      return () => clearTimeout(timeoutId)
    }
  }, [uiState.isConnected, loadTools, clearProgressEvents])

  // Wrapper functions to maintain the same interface
  const toggleTool = useCallback(async (toolId: string) => {
    await apiToggleTool(toolId)
  }, [apiToggleTool])

  const clearChat = useCallback(async () => {
    const success = await apiClearChat()
    if (success) {
      setSessionState({ reasoning: null, streaming: null, toolExecutions: [], toolProgress: [] })
      setUIState(prev => ({ ...prev, isTyping: false }))
      // Clear progress states and analysis data when clearing chat
      clearProgress()
      clearAnalysis()
    }
  }, [apiClearChat, clearProgress, clearAnalysis])

  const sendMessage = useCallback(async (e: React.FormEvent, files?: File[]) => {
    e.preventDefault()
    if (!inputMessage.trim() && (!files || files.length === 0)) return

    const userMessage: Message = {
      id: Date.now(),
      text: inputMessage,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString(),
      ...(files && files.length > 0 ? {
        uploadedFiles: files.map(file => ({
          name: file.name,
          type: file.type,
          size: file.size
        }))
      } : {})
    }

    // Generate new turn ID for this conversation turn
    const newTurnId = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    currentTurnIdRef.current = newTurnId
    
    setMessages(prev => [...prev, userMessage])
    setUIState(prev => ({ ...prev, isTyping: false }))
    setSessionState({ reasoning: null, streaming: null, toolExecutions: [], toolProgress: [] })
    
    // Clear progress states and analysis data for new conversation turn
    clearProgress()
    clearAnalysis()
    
    // Reset ref as well
    currentToolExecutionsRef.current = []

    const messageToSend = inputMessage || (files && files.length > 0 ? "Please analyze the uploaded file(s)." : "")
    setInputMessage('')

    await apiSendMessage(
      messageToSend,
      files,
      () => {
        // Success callback - already handled in API hook
      },
      (error) => {
        // Error callback
        setSessionState({ reasoning: null, streaming: null, toolExecutions: [], toolProgress: [] })
      }
    )
  }, [inputMessage, apiSendMessage, clearProgress, clearAnalysis])

  // Group messages into turns for better UI
  const groupedMessages = useMemo(() => {
    const grouped: Array<{
      type: 'user' | 'assistant_turn'
      messages: Message[]
      id: string
    }> = []
    
    let currentAssistantTurn: Message[] = []
    
    for (const message of messages) {
      if (message.sender === 'user') {
        // Finish current assistant turn if exists
        if (currentAssistantTurn.length > 0) {
          grouped.push({
            type: 'assistant_turn',
            messages: [...currentAssistantTurn],
            id: `turn_${currentAssistantTurn[0].id}`
          })
          currentAssistantTurn = []
        }
        
        // Add user message
        grouped.push({
          type: 'user',
          messages: [message],
          id: `user_${message.id}`
        })
      } else {
        // Add to current assistant turn
        currentAssistantTurn.push(message)
      }
    }
    
    // Finish final assistant turn if exists
    if (currentAssistantTurn.length > 0) {
      grouped.push({
        type: 'assistant_turn',
        messages: [...currentAssistantTurn],
        id: `turn_${currentAssistantTurn[0].id}`
      })
    }
    
    return grouped
  }, [messages])

  // Progress panel toggle function
  const toggleProgressPanel = useCallback(() => {
    setUIState(prev => ({ ...prev, showProgressPanel: !prev.showProgressPanel }))
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])

  return {
    messages,
    groupedMessages,
    inputMessage,
    setInputMessage,
    isConnected: uiState.isConnected,
    isTyping: uiState.isTyping,
    availableTools,
    currentToolExecutions: sessionState.toolExecutions,
    currentReasoning: sessionState.reasoning,
    toolProgress: progressStates,
    showProgressPanel: uiState.showProgressPanel,
    toggleProgressPanel,
    sendMessage,
    clearChat,
    toggleTool,
    refreshTools: loadTools,
    sessionId
  }
}
