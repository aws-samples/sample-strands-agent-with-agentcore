import { useCallback } from 'react'
import { Message, ToolExecution } from '@/types/chat'
import { StreamEvent, ChatSessionState, ChatUIState, ToolProgressState } from '@/types/events'

interface UseStreamEventsProps {
  sessionState: ChatSessionState
  setSessionState: React.Dispatch<React.SetStateAction<ChatSessionState>>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setUIState: React.Dispatch<React.SetStateAction<ChatUIState>>
  currentToolExecutionsRef: React.MutableRefObject<ToolExecution[]>
  currentTurnIdRef: React.MutableRefObject<string | null>
  availableTools?: Array<{
    id: string
    name: string
    tool_type?: string
  }>
}

export const useStreamEvents = ({
  sessionState,
  setSessionState,
  setMessages,
  setUIState,
  currentToolExecutionsRef,
  currentTurnIdRef,
  availableTools = []
}: UseStreamEventsProps) => {
  const handleReasoningEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'reasoning') {
      setSessionState(prev => ({
        ...prev,
        reasoning: { text: data.text, isActive: true }
      }))
    }
  }, [setSessionState])

  const handleResponseEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'response') {
      // Finalize reasoning step if active
      if (sessionState.reasoning?.isActive) {
        setSessionState(prev => ({
          ...prev,
          reasoning: prev.reasoning ? { ...prev.reasoning, isActive: false } : null
        }))
      }

      // Update streaming text
      if (!sessionState.streaming) {
        const newId = Date.now() + Math.random()
        setSessionState(prev => ({
          ...prev,
          streaming: { text: data.text, id: newId }
        }))
        
        // Add new streaming message
        setMessages(prev => [...prev, {
          id: newId,
          text: data.text,
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString(),
          isStreaming: true,
          images: []
        }])
      } else {
        // Update existing streaming message
        setSessionState(prev => ({
          ...prev,
          streaming: prev.streaming ? { ...prev.streaming, text: prev.streaming.text + data.text } : null
        }))
        
        setMessages(prev => prev.map(msg => 
          msg.id === sessionState.streaming?.id 
            ? { ...msg, text: msg.text + data.text }
            : msg
        ))
      }
    }
  }, [sessionState, setSessionState, setMessages])

  const handleToolUseEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'tool_use') {
      // Fix empty string input - convert to empty object for UI consistency
      const normalizedInput = (data.input as any) === "" || data.input === null ? {} : data.input
      
      // Agent-type tool auto-popup removed - users can manually open Analysis Panel if needed
      
      // Check if tool execution already exists using ref for synchronous access
      const existingToolIndex = currentToolExecutionsRef.current.findIndex(tool => tool.id === data.toolUseId)
      
      if (existingToolIndex >= 0) {
        // Update existing tool execution
        const updatedExecutions = [...currentToolExecutionsRef.current]
        updatedExecutions[existingToolIndex] = {
          ...updatedExecutions[existingToolIndex],
          toolInput: normalizedInput
        }
        
        
        // Update ref
        currentToolExecutionsRef.current = updatedExecutions
        
        // Update state
        setSessionState(prev => ({
          ...prev,
          toolExecutions: updatedExecutions
        }))
        
        // Update existing tool message
        setMessages(prevMessages => prevMessages.map(msg => {
          if (msg.isToolMessage && msg.toolExecutions) {
            const updatedToolExecutions = msg.toolExecutions.map(tool =>
              tool.id === data.toolUseId
                ? { ...tool, toolInput: data.input }
                : tool
            )
            return { ...msg, toolExecutions: updatedToolExecutions }
          }
          return msg
        }))
      } else {
        // Create new tool execution
        const newToolExecution: ToolExecution = {
          id: data.toolUseId,
          toolName: data.name,
          toolInput: normalizedInput,
          reasoning: [],
          isComplete: false,
          isExpanded: true
        }
        

        const updatedExecutions = [...currentToolExecutionsRef.current, newToolExecution]
        
        // Update ref
        currentToolExecutionsRef.current = updatedExecutions
        
        // Update state
        setSessionState(prev => ({
          ...prev,
          toolExecutions: updatedExecutions
        }))

        // Always create a new tool message for each tool execution
        // This ensures each tool appears in the correct chronological position
        const toolMessageId = Date.now() + Math.random() // Add random to avoid ID conflicts
        setMessages(prevMessages => [...prevMessages, {
          id: toolMessageId,
          text: '',
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString(),
          toolExecutions: [newToolExecution],
          isToolMessage: true,
          turnId: currentTurnIdRef.current || undefined
        }])
      }
    }
  }, [availableTools, currentToolExecutionsRef, currentTurnIdRef, setSessionState, setMessages])

  const handleToolResultEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'tool_result') {

      // Update ref first for synchronous access
      const updatedExecutions = currentToolExecutionsRef.current.map(tool =>
        tool.id === data.toolUseId
          ? { ...tool, toolResult: data.result, images: data.images, isComplete: true }
          : tool
      )
      
      currentToolExecutionsRef.current = updatedExecutions
      
      // Update state
      setSessionState(prev => ({
        ...prev,
        toolExecutions: updatedExecutions
      }))

      // Update tool message
      setMessages(prev => prev.map(msg => {
        if (msg.isToolMessage && msg.toolExecutions) {
          const updatedToolExecutions = msg.toolExecutions.map(tool =>
            tool.id === data.toolUseId
              ? { ...tool, toolResult: data.result, images: data.images, isComplete: true }
              : tool
          )
          return { ...msg, toolExecutions: updatedToolExecutions }
        }
        return msg
      }))
    }
  }, [currentToolExecutionsRef, sessionState, setSessionState, setMessages])

  const handleCompleteEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'complete') {
      // Finalize streaming message
      if (sessionState.streaming) {
        setMessages(prev => prev.map(msg =>
          msg.id === sessionState.streaming?.id
            ? { ...msg, isStreaming: false, images: data.images || [] }
            : msg
        ))
      }



      // Reset session state
      setSessionState({
        reasoning: null,
        streaming: null,
        toolExecutions: [],
        toolProgress: []
      })

      setUIState(prev => ({ ...prev, isTyping: false, showProgressPanel: false }))
    }
  }, [sessionState, setSessionState, setMessages, setUIState])

  const handleInitEvent = useCallback(() => {
    setUIState(prev => ({ ...prev, isTyping: true }))
  }, [setUIState])


  const handleProgressEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'tool_progress') {
      const progressState: ToolProgressState = {
        context: data.toolId, // Map toolId to context for compatibility
        executor: 'tool-executor',
        sessionId: data.sessionId,
        step: data.step,
        message: data.message,
        progress: data.progress,
        timestamp: data.timestamp,
        metadata: data.metadata || {},
        isActive: data.step !== 'completed' && data.step !== 'error'
      }

      setSessionState(prev => {
        // Find existing progress for this tool
        const existingIndex = prev.toolProgress.findIndex(p => p.context === data.toolId && p.sessionId === data.sessionId)
        
        if (existingIndex >= 0) {
          // Update existing progress
          const updatedProgress = [...prev.toolProgress]
          updatedProgress[existingIndex] = progressState
          return { ...prev, toolProgress: updatedProgress }
        } else {
          // Add new progress
          return { ...prev, toolProgress: [...prev.toolProgress, progressState] }
        }
      })

      // Show progress panel when tool starts or has active progress
      if (data.step === 'connecting' || data.step === 'fetching' || data.step === 'processing') {
        setUIState(prev => ({ ...prev, showProgressPanel: true }))
      }

      // Auto-hide progress panel after completion (with delay)
      if (data.step === 'completed' || data.step === 'error') {
        setTimeout(() => {
          setSessionState(prev => ({
            ...prev,
            toolProgress: prev.toolProgress.filter(p => p.isActive)
          }))
          
          // Hide panel if no active progress
          setUIState(prev => {
            const hasActiveProgress = prev.showProgressPanel && 
              sessionState.toolProgress.some(p => p.isActive)
            return { ...prev, showProgressPanel: hasActiveProgress }
          })
        }, 3000) // Hide after 3 seconds
      }
    }
  }, [setSessionState, setUIState, sessionState.toolProgress])

  const handleErrorEvent = useCallback((data: StreamEvent) => {
    if (data.type === 'error') {
      setMessages(prev => [...prev, {
        id: Date.now(),
        text: data.message,
        sender: 'bot',
        timestamp: new Date().toLocaleTimeString()
      }])
      
      setUIState(prev => ({ ...prev, isTyping: false }))
      setSessionState({ reasoning: null, streaming: null, toolExecutions: [], toolProgress: [] })
    }
  }, [setMessages, setUIState, setSessionState])

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case 'reasoning':
        handleReasoningEvent(event)
        break
      case 'response':
        handleResponseEvent(event)
        break
      case 'tool_use':
        handleToolUseEvent(event)
        break
      case 'tool_result':
        handleToolResultEvent(event)
        break
      case 'tool_progress':
        handleProgressEvent(event)
        break
      case 'complete':
        handleCompleteEvent(event)
        break
      case 'init':
      case 'thinking':
        handleInitEvent()
        break
      case 'error':
        handleErrorEvent(event)
        break
      // spending_analysis_* events removed - now handled by useAnalysisStream
    }
  }, [
    handleReasoningEvent,
    handleResponseEvent,
    handleToolUseEvent,
    handleToolResultEvent,
    handleProgressEvent,
    handleCompleteEvent,
    handleInitEvent,
    handleErrorEvent
  ])

  return { handleStreamEvent }
}
