"use client"

import React, { useState, useEffect } from 'react'
import { FileText, Newspaper, BookOpen, Briefcase, FileEdit, Pencil, ArrowLeft, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Step 1: Document Type
const DOCUMENT_TYPES = [
  { id: 'blog', label: 'Blog Post', icon: <Newspaper className="h-4 w-4" /> },
  { id: 'report', label: 'Technical Report', icon: <FileText className="h-4 w-4" /> },
  { id: 'essay', label: 'Essay', icon: <BookOpen className="h-4 w-4" /> },
  { id: 'proposal', label: 'Proposal', icon: <Briefcase className="h-4 w-4" /> },
  { id: 'article', label: 'Article', icon: <FileEdit className="h-4 w-4" /> },
  { id: 'custom', label: 'Custom', icon: <Pencil className="h-4 w-4" /> },
]

// Step 2: Length
const LENGTH_OPTIONS = [
  { id: 'short', label: 'Short', description: '~500 words', target: 500 },
  { id: 'medium', label: 'Medium', description: '~1,000 words', target: 1000 },
  { id: 'long', label: 'Long', description: '~2,000 words', target: 2000 },
  { id: 'verylong', label: 'Very Long', description: '3,000+ words', target: 3000 },
  { id: 'custom', label: 'Custom', description: 'Specify your own', target: 0 },
]


interface ComposeWizardProps {
  isOpen: boolean
  onComplete: (config: ComposeConfig) => void
  onClose: () => void
  inputRect: DOMRect | null
}

export interface ComposeConfig {
  documentType: string
  length: string
  lengthTarget: number
  topic: string
}

type WizardStep = 'type' | 'length' | 'confirm'

export function ComposeWizard({ isOpen, onComplete, onClose, inputRect }: ComposeWizardProps) {
  const [step, setStep] = useState<WizardStep>('type')
  const [config, setConfig] = useState<Partial<ComposeConfig>>({})
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customInputValue, setCustomInputValue] = useState('')
  const [topicInput, setTopicInput] = useState('')
  const [useFreeTopic, setUseFreeTopic] = useState(false)
  const customInputRef = React.useRef<HTMLInputElement>(null)
  const topicInputRef = React.useRef<HTMLInputElement>(null)

  // Reset when opened
  useEffect(() => {
    if (isOpen) {
      setStep('type')
      setConfig({})
      setSelectedIndex(0)
      setShowCustomInput(false)
      setCustomInputValue('')
      setTopicInput('')
      setUseFreeTopic(false)
    }
  }, [isOpen])

  // Focus custom input when shown
  useEffect(() => {
    if (showCustomInput && customInputRef.current) {
      customInputRef.current.focus()
    }
  }, [showCustomInput])

  // Focus topic input when reaching confirmation step (only if not using free topic)
  useEffect(() => {
    if (step === 'confirm' && !useFreeTopic && topicInputRef.current) {
      setTimeout(() => {
        topicInputRef.current?.focus()
      }, 100)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // Get current options based on step
  const getCurrentOptions = () => {
    switch (step) {
      case 'type': return DOCUMENT_TYPES
      case 'length': return LENGTH_OPTIONS
      default: return []
    }
  }

  const currentOptions = getCurrentOptions()

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle custom input mode
      if (showCustomInput) {
        if (e.key === 'Enter') {
          e.preventDefault()
          handleCustomInputSubmit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          handleBack()
        }
        return
      }

      if (step === 'confirm') return // Handle separately for confirm step

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % currentOptions.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev - 1 + currentOptions.length) % currentOptions.length)
          break
        case 'Enter':
          e.preventDefault()
          handleSelect(currentOptions[selectedIndex])
          break
        case 'Escape':
          e.preventDefault()
          if (step === 'type') {
            onClose()
          } else {
            handleBack()
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, step, selectedIndex, currentOptions, showCustomInput, customInputValue])

  const handleSelect = (option: any) => {
    // Check if custom option selected
    if (option.id === 'custom') {
      setShowCustomInput(true)
      setCustomInputValue('')
      return
    }

    const newConfig = { ...config }

    switch (step) {
      case 'type':
        newConfig.documentType = option.id
        setConfig(newConfig)
        setStep('length')
        break
      case 'length':
        newConfig.length = option.id
        newConfig.lengthTarget = option.target
        setConfig(newConfig as ComposeConfig)
        setStep('confirm')
        break
    }

    setSelectedIndex(0)
  }

  const handleCustomInputSubmit = () => {
    if (!customInputValue.trim()) return

    const newConfig = { ...config }

    switch (step) {
      case 'type':
        newConfig.documentType = customInputValue.trim()
        setConfig(newConfig)
        setStep('length')
        break
      case 'length':
        newConfig.length = customInputValue.trim()
        newConfig.lengthTarget = 0 // Custom length
        setConfig(newConfig as ComposeConfig)
        setStep('confirm')
        break
    }

    setShowCustomInput(false)
    setCustomInputValue('')
    setSelectedIndex(0)
  }

  const handleBack = () => {
    // If showing custom input, go back to option selection
    if (showCustomInput) {
      setShowCustomInput(false)
      setCustomInputValue('')
      return
    }

    const steps: WizardStep[] = ['type', 'length', 'confirm']
    const currentIndex = steps.indexOf(step)
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1])
      setSelectedIndex(0)
    }
  }

  const handleConfirm = () => {
    if (!useFreeTopic && !topicInput.trim()) return

    const finalConfig: ComposeConfig = {
      ...config,
      topic: useFreeTopic
        ? "" // Empty string for auto-topic - backend will determine from conversation context
        : topicInput.trim()
    } as ComposeConfig

    onComplete(finalConfig)
    onClose()
  }

  if (!isOpen || !inputRect) return null

  // Position above the input
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: `${window.innerHeight - inputRect.top + 8}px`,
    left: `${inputRect.left}px`,
    width: `${Math.min(inputRect.width, 500)}px`,
    zIndex: 50,
  }

  const getStepTitle = () => {
    if (showCustomInput) {
      switch (step) {
        case 'type': return 'Enter custom document type'
        case 'length': return 'Describe desired length'
        default: return 'Enter custom value'
      }
    }
    switch (step) {
      case 'type': return 'Choose document type'
      case 'length': return 'How long should it be?'
      case 'confirm': return 'Ready to start?'
    }
  }

  const getCustomInputPlaceholder = () => {
    switch (step) {
      case 'type': return 'e.g., Technical manual, Research paper, etc.'
      case 'length': return 'e.g., around 1500 words, 5-10 pages, etc.'
      default: return 'Enter your custom value...'
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Menu */}
      <div
        style={menuStyle}
        className="z-50 bg-popover border border-border rounded-lg shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95"
      >
        {/* Header */}
        <div className="px-3 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step !== 'type' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="h-6 w-6 p-0"
              >
                <ArrowLeft className="h-3 w-3" />
              </Button>
            )}
            <span className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">
              Compose Mode
            </span>
          </div>
          <span className="text-caption text-muted-foreground/60">
            Step {['type', 'length', 'confirm'].indexOf(step) + 1}/3
          </span>
        </div>

        <div className="px-4 py-2">
          <div className="text-label font-medium text-foreground">
            {getStepTitle()}
          </div>
        </div>

        {/* Options, Custom Input, or Confirmation */}
        {step !== 'confirm' ? (
          showCustomInput ? (
            // Custom input mode
            <div className="px-4 py-4 space-y-3">
              <Input
                ref={customInputRef}
                type="text"
                value={customInputValue}
                onChange={(e) => setCustomInputValue(e.target.value)}
                placeholder={getCustomInputPlaceholder()}
                className="w-full"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customInputValue.trim()) {
                    handleCustomInputSubmit()
                  }
                }}
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBack}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button
                  size="sm"
                  onClick={handleCustomInputSubmit}
                  disabled={!customInputValue.trim()}
                  className="flex-1 gap-2"
                >
                  Continue
                </Button>
              </div>
            </div>
          ) : (
            // Option selection mode
            <div className="max-h-[350px] overflow-y-auto">
              {currentOptions.map((option, index) => (
              <button
                key={option.id}
                onClick={() => handleSelect(option)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`w-full text-left px-4 py-2.5 transition-colors flex items-start gap-3 ${
                  selectedIndex === index ? 'bg-accent' : 'hover:bg-accent/50'
                }`}
              >
                {'icon' in option && (
                  <div className={`mt-0.5 transition-colors ${
                    selectedIndex === index ? 'text-foreground' : 'text-muted-foreground'
                  }`}>
                    {option.icon}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-label text-foreground">
                    {option.label}
                  </div>
                  {'description' in option && (
                    <div className="text-caption text-muted-foreground mt-0.5">
                      {option.description}
                    </div>
                  )}
                </div>
                {selectedIndex === index && (
                  <div className="text-caption text-muted-foreground/40 mt-1">↵</div>
                )}
              </button>
              ))}
            </div>
          )
        ) : (
          <div className="px-4 py-3 space-y-3">
            <div className="space-y-2 text-label">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Type:</span>
                <span className="font-medium">
                  {DOCUMENT_TYPES.find(t => t.id === config.documentType)?.label || config.documentType}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Length:</span>
                <span className="font-medium">
                  {LENGTH_OPTIONS.find(l => l.id === config.length)?.description || config.length}
                </span>
              </div>
            </div>

            {/* Topic Input */}
            <div className="space-y-3">
              <label className="text-caption font-medium text-muted-foreground">
                What's your topic?
              </label>

              {/* Topic Selection */}
              <div className="space-y-2">
                <label className="flex items-start gap-2 cursor-pointer group">
                  <input
                    type="radio"
                    checked={!useFreeTopic}
                    onChange={() => setUseFreeTopic(false)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="text-label font-medium">Specific Topic</div>
                    <Input
                      ref={topicInputRef}
                      type="text"
                      value={topicInput}
                      onChange={(e) => {
                        setTopicInput(e.target.value)
                        setUseFreeTopic(false)
                      }}
                      disabled={useFreeTopic}
                      placeholder="e.g., the benefits of remote work for software teams"
                      className="w-full mt-1.5"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !useFreeTopic && topicInput.trim()) {
                          handleConfirm()
                        }
                      }}
                    />
                  </div>
                </label>

                <label className="flex items-start gap-2 cursor-pointer group">
                  <input
                    type="radio"
                    checked={useFreeTopic}
                    onChange={() => setUseFreeTopic(true)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="text-label font-medium">Free Topic</div>
                    <div className="text-caption text-muted-foreground mt-0.5">
                      Let AI determine a relevant topic based on our conversation
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBack}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                size="sm"
                onClick={handleConfirm}
                disabled={!useFreeTopic && !topicInput.trim()}
                className="flex-1 gap-2"
              >
                <Check className="h-3 w-3" />
                Start Writing
              </Button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-3 py-2 bg-muted/30 border-t border-border">
          <div className="text-caption text-muted-foreground flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 bg-background rounded text-[10px] font-mono border border-border">
              ↑↓
            </kbd>
            <span>Navigate</span>
            <kbd className="px-1.5 py-0.5 bg-background rounded text-[10px] font-mono border border-border">
              ↵
            </kbd>
            <span>Select</span>
            <kbd className="px-1.5 py-0.5 bg-background rounded text-[10px] font-mono border border-border">
              Esc
            </kbd>
            <span>{step === 'type' ? 'Close' : 'Back'}</span>
          </div>
        </div>
      </div>
    </>
  )
}
