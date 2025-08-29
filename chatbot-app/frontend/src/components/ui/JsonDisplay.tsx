import React, { useState, useMemo, useCallback } from 'react'
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'

interface JsonDisplayProps {
  data: any
  maxLines?: number
  className?: string
  label?: string
}

// Optimized syntax highlighting for JSON
const highlightJson = (json: string): JSX.Element[] => {
  // Early return for large strings to prevent performance issues
  if (json.length > 10000) {
    return [<span key="0" className="text-foreground">{json}</span>]
  }
  
  const tokens = json.split(/(\s|"[^"]*"|'[^']*'|\{|\}|\[|\]|:|,|true|false|null|\d+\.?\d*)/)
  
  return tokens.map((token, index) => {
    if (!token || /^\s+$/.test(token)) {
      return <span key={index}>{token}</span>
    }
    
    // String values
    if (token.startsWith('"') && token.endsWith('"')) {
      return <span key={index} className="text-green-600 dark:text-green-400 font-medium">{token}</span>
    }
    
    // Property keys (strings followed by colon)
    if (tokens[index + 1] === ':') {
      return <span key={index} className="text-blue-600 dark:text-blue-400 font-semibold">{token}</span>
    }
    
    // Numbers
    if (/^\d+\.?\d*$/.test(token)) {
      return <span key={index} className="text-purple-600 dark:text-purple-400">{token}</span>
    }
    
    // Booleans and null
    if (['true', 'false', 'null'].includes(token)) {
      return <span key={index} className="text-orange-600 dark:text-orange-400 font-medium">{token}</span>
    }
    
    // Brackets and braces
    if (['{', '}', '[', ']'].includes(token)) {
      return <span key={index} className="text-foreground font-bold">{token}</span>
    }
    
    // Colons and commas
    if ([':', ','].includes(token)) {
      return <span key={index} className="text-muted-foreground">{token}</span>
    }
    
    return <span key={index}>{token}</span>
  })
}

// Format object/array data for better display
const formatJsonData = (data: any): string => {
  if (data === null || data === undefined) {
    return 'null'
  }
  
  if (typeof data === 'string') {
    // Always try to parse as JSON first
    try {
      const parsed = JSON.parse(data)
      return JSON.stringify(parsed, null, 2)
    } catch {
      // Not JSON, return as formatted text
      return data
    }
  }
  
  if (typeof data === 'object') {
    return JSON.stringify(data, null, 2)
  }
  
  return String(data)
}

export const JsonDisplay: React.FC<JsonDisplayProps> = ({ 
  data, 
  maxLines = 8, 
  className = "",
  label 
}) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  
  // Memoize expensive operations
  const jsonString = useMemo(() => formatJsonData(data), [data])
  const lines = useMemo(() => jsonString.split('\n'), [jsonString])
  const needsTruncation = useMemo(() => lines.length > maxLines || jsonString.length > 500, [lines.length, maxLines, jsonString.length])
  
  const displayText = useMemo(() => {
    return isExpanded || !needsTruncation 
      ? jsonString 
      : lines.slice(0, maxLines).join('\n') + '\n...'
  }, [isExpanded, needsTruncation, jsonString, lines, maxLines])
  
  // Memoize highlighted JSX to prevent re-processing on every render
  const highlightedContent = useMemo(() => {
    // Only highlight when expanded or for smaller content
    if ((!isExpanded && jsonString.length > 2000) || jsonString.length > 50000) {
      return <span className="text-foreground">{displayText}</span>
    }
    return highlightJson(displayText)
  }, [displayText, isExpanded, jsonString.length])
  
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(jsonString)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [jsonString])
  
  const handleToggleExpand = useCallback(() => {
    setIsExpanded(!isExpanded)
  }, [isExpanded])
  
  return (
    <div className={`bg-background rounded-lg border border-border ${className}`} style={{ maxWidth: '100%', width: '100%' }}>
      {/* Header with label and copy button */}
      {label && (
        <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border rounded-t-lg">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted"
            title="Copy JSON"
          >
            {isCopied ? (
              <>
                <Check className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
        </div>
      )}
      
      {/* JSON Content */}
      <div className="p-3" style={{ maxWidth: '100%', overflow: 'hidden' }}>
        <div className={`font-mono text-xs leading-relaxed ${needsTruncation && !isExpanded ? 'max-h-48 overflow-hidden' : ''}`}>
          <pre className="whitespace-pre-wrap" style={{ maxWidth: '100%', overflow: 'auto', wordBreak: 'break-all' }}>
            {highlightedContent}
          </pre>
        </div>
        
        {/* Expand/Collapse Button */}
        {needsTruncation && (
          <div className="mt-3 pt-2 border-t border-border">
            <button
              onClick={handleToggleExpand}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Show Less ({lines.length} lines)
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Show More (+{lines.length - maxLines} lines)
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Helper component for displaying key-value pairs in a more readable format
export const KeyValueDisplay: React.FC<{ data: Record<string, any>, className?: string }> = ({ 
  data, 
  className = "" 
}) => {
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    return (
      <div className={`text-sm text-muted-foreground italic p-3 bg-muted rounded ${className}`}>
        No parameters
      </div>
    )
  }
  
  return (
    <div className={`space-y-2 ${className}`}>
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
          <div className="text-sm font-semibold text-primary min-w-0 sm:w-32 flex-shrink-0">
            {key}:
          </div>
          <div className="text-sm text-foreground min-w-0 flex-1">
            {typeof value === 'object' ? (
              <JsonDisplay data={value} maxLines={3} className="mt-1" />
            ) : (
              <span className="font-mono bg-muted px-2 py-1 rounded text-xs">
                {typeof value === 'string' ? `"${value}"` : String(value)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}