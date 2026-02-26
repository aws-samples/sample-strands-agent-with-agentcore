import React, { useState, useRef, useEffect } from 'react'
import { fetchAuthSession } from 'aws-amplify/auth'
import { Download, Loader2, Terminal } from 'lucide-react'
import { ToolExecution } from '@/types/chat'
import { JsonDisplay } from '@/components/ui/JsonDisplay'

// ---- Helpers ----

/** Check if a tool execution is a code-agent call (direct, prefixed, or via skill_executor). */
export const isCodeAgentExecution = (toolExec: ToolExecution): boolean =>
  toolExec.toolName === 'code_agent' ||
  toolExec.toolName === 'agentcore_code-agent' ||
  (toolExec.toolName === 'skill_executor' && toolExec.toolInput?.tool_name === 'code_agent')

/** Strip workspace prefix from absolute paths (e.g. /tmp/workspaces/user/session/src/foo.py → src/foo.py). */
export const shortenWorkspacePath = (p: string): string => {
  const m = p.match(/\/workspaces\/[^/]+\/[^/]+\/(.+)$/)
  if (m) return m[1]
  return p.split('/').pop() || p
}

/** Strip workspace prefix up to session ID, keeping only the relative path.
 *  /tmp/workspaces/{user}/{session}/src/foo.py  →  src/foo.py
 *  /workspaces/{user}/{session}/src/foo.py      →  src/foo.py
 *  /tmp/workspaces/{user}/{session}             →  .
 */
const cleanContent = (s: string) =>
  s.replace(/\/(?:tmp\/)?workspaces\/[^\s/]+\/[^\s/]+(?:\/(\S+))?/g,
    (_m, rest) => rest || '.')

// ---- Real-time progress (terminal style) ----

interface CodeAgentTerminalProps {
  steps: Array<{ stepNumber: number; content: string }>
  completed?: boolean  // When true, renders in collapsed state with expand toggle
}

/** Terminal-style progress log for code agent steps. Auto-scrolls to bottom. */
export const CodeAgentTerminal = React.memo<CodeAgentTerminalProps>(({ steps, completed = false }) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isExpanded, setIsExpanded] = useState(!completed)

  useEffect(() => {
    if (scrollRef.current && isExpanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [steps.length, isExpanded])

  return (
    <div className="mt-1 rounded-md border border-gray-300 dark:border-white/10 bg-gray-900 dark:bg-[#0d1117] overflow-hidden shadow-sm">
      {/* Title bar */}
      <div
        className={`flex items-center gap-1.5 px-3 py-1 border-b border-white/5 ${completed ? 'cursor-pointer hover:bg-white/5' : ''}`}
        onClick={completed ? () => setIsExpanded(prev => !prev) : undefined}
      >
        <Terminal className="h-3 w-3 text-green-400/70" />
        <span className="text-[11px] text-gray-400 font-mono">code-agent</span>
        {completed && (
          <span className="text-[10px] text-gray-500 font-mono ml-1">
            ({steps.length} steps)
          </span>
        )}
        <span className="ml-auto flex gap-0.5">
          {completed ? (
            <svg className={`h-3 w-3 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 12 12" fill="none">
              <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <>
              <span className="w-1 h-1 bg-green-400 rounded-full animate-pulse" />
              <span className="w-1 h-1 bg-green-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 bg-green-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
            </>
          )}
        </span>
      </div>
      {/* Log area */}
      {isExpanded && (
        <div ref={scrollRef} className="px-3 py-2 max-h-40 overflow-y-auto scrollbar-thin">
          {steps.map((step, i) => {
            const isHeartbeat = step.content.startsWith('Working...') ||
                                step.content.startsWith('Code agent started')
            return (
              <div key={i} className="flex gap-2 text-[12px] leading-relaxed font-mono">
                <span className={`select-none flex-shrink-0 ${isHeartbeat ? 'text-blue-400' : 'text-green-500/70'}`}>
                  {isHeartbeat ? '●' : '$'}
                </span>
                <span className={`whitespace-pre-wrap break-words ${isHeartbeat ? 'text-gray-400 italic' : 'text-gray-300'}`}>
                  {cleanContent(step.content)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
CodeAgentTerminal.displayName = 'CodeAgentTerminal'

// ---- Expanded details (todos, files changed) ----

interface CodeAgentDetailsProps {
  toolExecution: ToolExecution
}

/** Renders todo checklist and files-changed summary inside the expanded tool section. */
export const CodeAgentDetails = React.memo<CodeAgentDetailsProps>(({ toolExecution }) => (
  <>
    {/* Todo checklist */}
    {toolExecution.codeTodos && toolExecution.codeTodos.length > 0 && (
      <div className="space-y-0.5 mt-1">
        {toolExecution.codeTodos.map((todo) => (
          <div key={todo.id} className="flex items-start gap-1.5 text-caption">
            {todo.status === 'completed' ? (
              <svg className="h-3 w-3 mt-0.5 text-green-500 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
                <path fillRule="evenodd" d="M10.22 2.22a.75.75 0 0 1 0 1.06L4.97 8.53 1.78 5.34a.75.75 0 0 1 1.06-1.06l2.13 2.13 4.19-4.19a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
              </svg>
            ) : todo.status === 'in_progress' ? (
              <span className="flex gap-0.5 mt-0.5 flex-shrink-0">
                <span className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" />
              </span>
            ) : (
              <svg className="h-3 w-3 mt-0.5 text-muted-foreground flex-shrink-0" viewBox="0 0 12 12" fill="none">
                <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
            <span className={todo.status === 'completed' ? 'line-through text-muted-foreground' : ''}>
              {todo.content}
            </span>
          </div>
        ))}
      </div>
    )}

    {/* Files changed (after completion) */}
    {toolExecution.isComplete &&
      toolExecution.codeResultMeta?.files_changed &&
      toolExecution.codeResultMeta.files_changed.length > 0 && (
      <div className="space-y-1">
        <div className="text-caption text-muted-foreground font-medium">
          {toolExecution.codeResultMeta.files_changed.length} file{toolExecution.codeResultMeta.files_changed.length !== 1 ? 's' : ''} changed
          {toolExecution.codeResultMeta.steps > 0 && (
            <span className="font-normal"> · {toolExecution.codeResultMeta.steps} steps</span>
          )}
        </div>
        <div className="space-y-0.5">
          {toolExecution.codeResultMeta.files_changed.map((f) => (
            <div key={f} className="flex items-center gap-1.5 text-caption font-mono text-muted-foreground">
              <svg className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" viewBox="0 0 12 12" fill="none">
                <path d="M2 1.5h5.5L10 4v6.5H2V1.5Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                <path d="M7.5 1.5V4H10" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
              </svg>
              <span className="truncate">{shortenWorkspacePath(f)}</span>
            </div>
          ))}
        </div>
      </div>
    )}
  </>
))
CodeAgentDetails.displayName = 'CodeAgentDetails'

// ---- Result display ----

interface CodeAgentResultProps {
  toolResult: string
}

/** Renders code agent result as full JSON (not markdown). */
export const CodeAgentResult = React.memo<CodeAgentResultProps>(({ toolResult }) => (
  <div className="text-label">
    <JsonDisplay data={toolResult} maxLines={6} label="Result" />
  </div>
))
CodeAgentResult.displayName = 'CodeAgentResult'

// ---- Download workspace button ----

interface CodeAgentDownloadButtonProps {
  sessionId?: string
}

/** Download workspace ZIP button for completed code agent executions. */
export const CodeAgentDownloadButton = ({ sessionId }: CodeAgentDownloadButtonProps) => {
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const authHeaders: Record<string, string> = {}
      try {
        const session = await fetchAuthSession()
        const token = session.tokens?.idToken?.toString()
        if (token) authHeaders['Authorization'] = `Bearer ${token}`
      } catch { /* auth optional */ }

      const response = await fetch(
        `/api/code-agent/workspace-download?sessionId=${encodeURIComponent(sessionId || '')}`,
        { headers: authHeaders }
      )

      if (!response.ok) {
        throw new Error(`Failed to list workspace files: ${response.status}`)
      }

      const { files } = await response.json() as {
        files: { relativePath: string; presignedUrl: string; size: number }[]
      }

      if (!files || files.length === 0) {
        alert('No workspace files found. The code agent may not have created any files yet.')
        return
      }

      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      let filesAdded = 0
      for (const file of files) {
        try {
          const fileResponse = await fetch(file.presignedUrl)
          if (fileResponse.ok) {
            const blob = await fileResponse.blob()
            zip.file(file.relativePath, blob)
            filesAdded++
          }
        } catch { /* skip failed files */ }
      }

      if (filesAdded === 0) {
        throw new Error('No files could be downloaded')
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const objectUrl = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `code-agent-workspace-${sessionId?.slice(0, 8) ?? 'files'}.zip`
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      console.error('[CodeAgent] Download failed:', error)
      alert(error instanceof Error ? error.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); handleDownload() }}
      disabled={downloading}
      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-caption font-medium text-primary border border-primary/40 hover:border-primary hover:bg-primary/10 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      title={downloading ? 'Preparing ZIP...' : 'Download workspace as ZIP'}
    >
      {downloading
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <Download className="h-3.5 w-3.5" />
      }
      <span>{downloading ? 'Preparing...' : 'Download'}</span>
    </button>
  )
}
