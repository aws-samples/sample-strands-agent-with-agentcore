"use client"

import React, { useState, useEffect } from 'react'
import { FileText, Newspaper, BookOpen, Briefcase, FileEdit, Pencil } from 'lucide-react'

interface ComposeOption {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  prompt: string
}

const COMPOSE_OPTIONS: ComposeOption[] = [
  {
    id: 'blog',
    label: 'Blog Post',
    description: 'Engaging article with SEO optimization',
    icon: <Newspaper className="h-4 w-4" />,
    prompt: 'Write a blog post about: '
  },
  {
    id: 'report',
    label: 'Technical Report',
    description: 'Structured report with data and analysis',
    icon: <FileText className="h-4 w-4" />,
    prompt: 'Write a technical report on: '
  },
  {
    id: 'essay',
    label: 'Essay',
    description: 'Academic or opinion essay',
    icon: <BookOpen className="h-4 w-4" />,
    prompt: 'Write an essay about: '
  },
  {
    id: 'proposal',
    label: 'Proposal',
    description: 'Business or project proposal',
    icon: <Briefcase className="h-4 w-4" />,
    prompt: 'Write a proposal for: '
  },
  {
    id: 'article',
    label: 'Article',
    description: 'Informative long-form content',
    icon: <FileEdit className="h-4 w-4" />,
    prompt: 'Write an article about: '
  },
  {
    id: 'custom',
    label: 'Custom Document',
    description: 'Specify your own requirements',
    icon: <Pencil className="h-4 w-4" />,
    prompt: 'Write a document: '
  },
]

interface ComposeCommandMenuProps {
  isOpen: boolean
  onSelect: (option: ComposeOption) => void
  onClose: () => void
  inputRect: DOMRect | null
}

export function ComposeCommandMenu({
  isOpen,
  onSelect,
  onClose,
  inputRect,
}: ComposeCommandMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Reset selection when menu opens
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0)
    }
  }, [isOpen])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % COMPOSE_OPTIONS.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev - 1 + COMPOSE_OPTIONS.length) % COMPOSE_OPTIONS.length)
          break
        case 'Enter':
          e.preventDefault()
          onSelect(COMPOSE_OPTIONS[selectedIndex])
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, selectedIndex, onSelect, onClose])

  if (!isOpen || !inputRect) return null

  // Position above the input (drop-up)
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: `${window.innerHeight - inputRect.top + 8}px`,
    left: `${inputRect.left}px`,
    width: `${Math.min(inputRect.width, 500)}px`,
    zIndex: 50,
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />

      {/* Menu */}
      <div
        style={menuStyle}
        className="z-50 bg-popover border border-border rounded-lg shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95"
      >
        <div className="px-3 py-2 bg-muted/50 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-caption font-semibold text-muted-foreground uppercase tracking-wide">
              Compose Mode
            </span>
            <span className="text-caption text-muted-foreground/60">
              Choose document type
            </span>
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {COMPOSE_OPTIONS.map((option, index) => (
            <button
              key={option.id}
              onClick={() => onSelect(option)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`w-full text-left px-4 py-3 transition-colors flex items-start gap-3 group ${
                selectedIndex === index ? 'bg-accent' : 'hover:bg-accent/50'
              }`}
            >
              <div className={`mt-0.5 transition-colors ${
                selectedIndex === index ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
              }`}>
                {option.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-label text-foreground">
                  {option.label}
                </div>
                <div className="text-caption text-muted-foreground mt-0.5">
                  {option.description}
                </div>
              </div>
              <div className="text-caption text-muted-foreground/40 mt-1">
                {selectedIndex === index && '↵'}
              </div>
            </button>
          ))}
        </div>

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
            <span>Close</span>
          </div>
        </div>
      </div>
    </>
  )
}

export { COMPOSE_OPTIONS }
export type { ComposeOption }
