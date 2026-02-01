"use client"

import React, { useEffect, useRef } from "react"
import { SlashCommand } from "./slashCommands"

interface SlashCommandPopoverProps {
  commands: SlashCommand[]
  selectedIndex: number
  onSelect: (command: SlashCommand) => void
  onClose: () => void
  anchorRect: DOMRect | null
}

export function SlashCommandPopover({
  commands,
  selectedIndex,
  onSelect,
  onClose,
  anchorRect,
}: SlashCommandPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const selectedItem = itemRefs.current[selectedIndex]
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  if (commands.length === 0 || !anchorRect) {
    return null
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    bottom: window.innerHeight - anchorRect.top + 8,
    left: anchorRect.left,
    maxWidth: Math.min(320, anchorRect.width),
    zIndex: 50,
  }

  return (
    <div
      ref={popoverRef}
      style={style}
      className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200"
    >
      <div className="px-3 py-2 border-b border-border/50">
        <span className="text-xs text-muted-foreground font-medium">Commands</span>
      </div>
      <div className="max-h-[200px] overflow-y-auto py-1">
        {commands.map((command, index) => {
          const Icon = command.icon
          const isSelected = index === selectedIndex

          return (
            <button
              key={command.name}
              ref={el => { itemRefs.current[index] = el }}
              onClick={() => onSelect(command)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                isSelected
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted/50'
              }`}
            >
              <div className={`p-1.5 rounded-md ${isSelected ? 'bg-primary/10' : 'bg-muted'}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{command.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {command.description}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <div className="px-3 py-1.5 border-t border-border/50 bg-muted/30">
        <span className="text-[10px] text-muted-foreground">
          ↑↓ to navigate • Enter to select • Esc to close
        </span>
      </div>
    </div>
  )
}
