"use client"

import React, { useEffect, useRef } from "react"
import { Tool } from "@/types/chat"
import { getToolIcon, getToolImageSrc } from "@/config/tool-icons"

interface ToolSuggestionsPopoverProps {
  tools: Tool[]
  selectedIndex: number
  onSelect: (tool: Tool) => void
  onClose: () => void
  anchorRect: DOMRect | null
}

export function ToolSuggestionsPopover({
  tools,
  selectedIndex,
  onSelect,
  onClose,
  anchorRect,
}: ToolSuggestionsPopoverProps) {
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

  if (tools.length === 0 || !anchorRect) {
    return null
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    bottom: window.innerHeight - anchorRect.top + 8,
    left: anchorRect.left,
    maxWidth: Math.min(400, anchorRect.width),
    zIndex: 50,
  }

  return (
    <div
      ref={popoverRef}
      style={style}
      className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200"
    >
      <div className="px-3 py-2 border-b border-border/50">
        <span className="text-xs text-muted-foreground font-medium">Available Tools</span>
      </div>
      <div className="max-h-[280px] overflow-y-auto py-1">
        {tools.map((tool, index) => {
          const ToolIcon = getToolIcon(tool.id)
          const imageSrc = getToolImageSrc(tool.id)
          const isSelected = index === selectedIndex
          const isEnabled = tool.enabled

          return (
            <button
              key={tool.id}
              ref={el => { itemRefs.current[index] = el }}
              onClick={() => onSelect(tool)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                isSelected
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted/50'
              }`}
            >
              {imageSrc ? (
                <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 overflow-hidden ${
                  isSelected ? 'bg-primary/10' : 'bg-muted'
                }`}>
                  <img
                    src={imageSrc}
                    alt={tool.name}
                    className="w-6 h-6 object-contain"
                  />
                </div>
              ) : (
                <div className={`p-1.5 rounded-md ${isSelected ? 'bg-primary/10' : 'bg-muted'}`}>
                  <ToolIcon className="w-4 h-4" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm flex items-center gap-2">
                  {tool.name}
                  {isEnabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                      Active
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {tool.description || 'No description'}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <div className="px-3 py-1.5 border-t border-border/50 bg-muted/30">
        <span className="text-[10px] text-muted-foreground">
          ↑↓ navigate • Tab add tool • Enter execute • Esc close
        </span>
      </div>
    </div>
  )
}
