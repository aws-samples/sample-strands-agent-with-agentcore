import React, { useState, useCallback, useMemo } from 'react'
import { fetchAuthSession } from 'aws-amplify/auth'
import { Download, ChevronDown, ChevronUp, Sparkles, Loader2 } from 'lucide-react'
import { ToolExecution } from '@/types/chat'
import { getToolDisplayName } from '@/utils/chat'
import { getToolImageSrc, getToolIcon, resolveEffectiveToolId } from '@/config/tool-icons'
import { ChartRenderer } from '@/components/canvas'
import { ChartToolResult } from '@/types/chart'
import { MapRenderer } from '@/components/MapRenderer'
import { MapToolResult } from '@/types/map'
import { JsonDisplay } from '@/components/ui/JsonDisplay'
import { Markdown } from '@/components/ui/Markdown'
import { LazyImage } from '@/components/ui/LazyImage'
import { getApiUrl } from '@/config/environment'

import type { ImageData } from '@/utils/imageExtractor'

// Code agent tool name check (handles direct call, skill_executor wrapping, and agentcore prefix)
const isCodeAgentExecution = (toolExec: ToolExecution): boolean =>
  toolExec.toolName === 'code_agent' ||
  toolExec.toolName === 'agentcore_code-agent' ||
  (toolExec.toolName === 'skill_executor' && toolExec.toolInput?.tool_name === 'code_agent')

// Word document tool names
const WORD_DOCUMENT_TOOLS = ['create_word_document', 'modify_word_document']
// Excel spreadsheet tool names
const EXCEL_SPREADSHEET_TOOLS = ['create_excel_spreadsheet', 'modify_excel_spreadsheet']
// PowerPoint presentation tool names
const POWERPOINT_TOOLS = ['create_presentation', 'update_slide_content', 'add_slide', 'delete_slides', 'move_slide', 'duplicate_slide', 'update_slide_notes']

interface ToolExecutionContainerProps {
  toolExecutions: ToolExecution[]
  compact?: boolean
  availableTools?: Array<{
    id: string
    name: string
    tool_type?: string
  }>
  sessionId?: string
  onOpenResearchArtifact?: (executionId: string) => void  // Open completed research in Canvas
  onOpenWordArtifact?: (filename: string) => void  // Open Word document in Canvas
  onOpenExcelArtifact?: (filename: string) => void  // Open Excel spreadsheet in Canvas
  onOpenPptArtifact?: (filename: string) => void  // Open PowerPoint presentation in Canvas
  onOpenExtractedDataArtifact?: (artifactId: string) => void  // Open extracted data in Canvas
  onOpenExcalidrawArtifact?: (artifactId: string) => void  // Open Excalidraw diagram in Canvas
}

// Collapsible Markdown component for tool results
const CollapsibleMarkdown = React.memo<{
  children: string;
  maxLines?: number;
  sessionId?: string;
}>(({ children, maxLines = 8, sessionId }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const lines = useMemo(() => children.split('\n'), [children])
  const needsTruncation = useMemo(() => lines.length > maxLines, [lines.length, maxLines])

  const displayContent = useMemo(() => {
    return isExpanded || !needsTruncation
      ? children
      : lines.slice(0, maxLines).join('\n') + '\n...'
  }, [isExpanded, needsTruncation, children, lines, maxLines])

  const handleToggleExpand = useCallback(() => {
    setIsExpanded(!isExpanded)
  }, [isExpanded])

  return (
    <div>
      <div className={needsTruncation && !isExpanded ? 'max-h-48 overflow-hidden' : ''}>
        <Markdown size="sm" sessionId={sessionId}>
          {displayContent}
        </Markdown>
      </div>

      {needsTruncation && (
        <button
          onClick={handleToggleExpand}
          className="flex items-center gap-1 text-caption text-primary hover:text-primary/80 transition-colors font-medium mt-1"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              Show more ({lines.length - maxLines} more lines)
            </>
          )}
        </button>
      )}
    </div>
  )
}, (prevProps, nextProps) => {
  return prevProps.children === nextProps.children &&
         prevProps.maxLines === nextProps.maxLines &&
         prevProps.sessionId === nextProps.sessionId
})

export const ToolExecutionContainer = React.memo<ToolExecutionContainerProps>(({ toolExecutions, compact = false, availableTools = [], sessionId, onOpenResearchArtifact, onOpenWordArtifact, onOpenExcelArtifact, onOpenPptArtifact, onOpenExtractedDataArtifact, onOpenExcalidrawArtifact }) => {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null)
  const [downloadingCodeAgent, setDownloadingCodeAgent] = useState(false)
  const [downloadingFiles, setDownloadingFiles] = useState<Set<string>>(new Set())

  // Extract output filename from Word tool result
  // Prefers metadata.filename if available, falls back to regex extraction
  const extractWordFilename = (toolResult: string, metadata?: any): string | null => {
    if (metadata?.filename) return metadata.filename
    if (!toolResult) return null
    const savedAsMatch = toolResult.match(/\*\*Saved as\*\*:\s*([\w\-. ]+\.docx)/i)
    if (savedAsMatch) return savedAsMatch[1].trim()
    const match = toolResult.match(/([\w\-. ]+\.docx)/i)
    return match ? match[1].trim() : null
  }

  // Extract output filename from Excel tool result
  // Prefers metadata.filename if available, falls back to regex extraction
  const extractExcelFilename = (toolResult: string, metadata?: any): string | null => {
    if (metadata?.filename) return metadata.filename
    if (!toolResult) return null
    const savedAsMatch = toolResult.match(/\*\*Saved as\*\*:\s*([\w\-. ]+\.xlsx)/i)
    if (savedAsMatch) return savedAsMatch[1].trim()
    const match = toolResult.match(/([\w\-. ]+\.xlsx)/i)
    return match ? match[1].trim() : null
  }

  // Extract output filename from PowerPoint tool result
  // Prefers metadata.filename if available, falls back to regex extraction
  const extractPptFilename = (toolResult: string, metadata?: any): string | null => {
    if (metadata?.filename) return metadata.filename
    if (!toolResult) return null
    const updatedMatch = toolResult.match(/\*\*Updated\*\*:\s*([\w\-. ]+\.pptx)/i)
    if (updatedMatch) return updatedMatch[1].trim()
    const filenameMatch = toolResult.match(/\*\*Filename\*\*:\s*([\w\-. ]+\.pptx)/i)
    if (filenameMatch) return filenameMatch[1].trim()
    const match = toolResult.match(/([\w\-. ]+\.pptx)/i)
    return match ? match[1].trim() : null
  }

  // Extract artifact ID from browser_extract tool result
  const extractArtifactId = (toolResult: string): string | null => {
    if (!toolResult) return null
    // Look for "Saved as artifact: artifact-id" pattern
    const match = toolResult.match(/\*\*Saved as artifact\*\*:\s*(extracted-[\w-]+)/)
    return match ? match[1] : null
  }

  // Check if excalidraw tool result was successful (for Canvas button display)
  const hasExcalidrawData = (toolResult: string): boolean => {
    if (!toolResult) return false
    try {
      const parsed = JSON.parse(toolResult)
      return parsed.success === true && !!parsed.excalidraw_data
    } catch {
      return false
    }
  }

  const containsMarkdown = (text: string): boolean => {
    if (typeof text !== 'string') return false
    try {
      JSON.parse(text)
      return false
    } catch {
      // Not valid JSON, check for markdown patterns
    }
    return /\[([^\]]+)\]\(([^)]+)\)|\*\*[^*]+\*\*|_{1,2}[^_]+_{1,2}|^#+\s/.test(text)
  }

  const toggleToolExpansion = (toolId: string) => {
    setExpandedTools(prev => {
      const newSet = new Set(prev)
      if (newSet.has(toolId)) {
        newSet.delete(toolId)
      } else {
        newSet.add(toolId)
      }
      return newSet
    })
  }

  const isToolExpanded = (toolId: string) => {
    return expandedTools.has(toolId)
  }

  if (!toolExecutions || toolExecutions.length === 0) {
    return null
  }

  // Memoize parsed chart data
  const toolExecutionsDeps = useMemo(() => {
    return toolExecutions.map(t => ({
      id: t.id,
      isComplete: t.isComplete,
      toolResult: t.toolResult,
      toolName: t.toolName
    }))
  }, [toolExecutions])

  const chartDataCache = useMemo(() => {
    const cache = new Map<string, { parsed: ChartToolResult, resultString: string }>();

    toolExecutionsDeps.forEach((deps) => {
      if ((deps.toolName === 'create_visualization' || deps.toolName === 'show_on_map' || deps.toolName === 'skill_executor') &&
          deps.toolResult &&
          deps.isComplete) {
        try {
          let parsed = JSON.parse(deps.toolResult);

          if (parsed.statusCode && parsed.body) {
            try {
              const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
              if (body.content && Array.isArray(body.content)) {
                const textContent = body.content.find((item: any) => item.type === 'text');
                if (textContent?.text) {
                  parsed = JSON.parse(textContent.text);
                }
              }
            } catch (unwrapError) {
              console.warn('Failed to unwrap Lambda response:', unwrapError);
            }
          }

          // For skill_executor, only cache if result contains chart_data or map_data
          // (otherwise it's a non-visualization result like web search)
          if (deps.toolName === 'skill_executor' && !parsed.chart_data && !parsed.map_data) {
            return;
          }

          cache.set(deps.id, {
            parsed,
            resultString: deps.toolResult
          });
        } catch (e) {
          // Invalid JSON, skip
        }
      }
    });

    return cache;
  }, [toolExecutionsDeps]);

  const renderVisualizationResult = useCallback((toolUseId: string) => {
    const cached = chartDataCache.get(toolUseId);
    if (!cached) return null;

    const result = cached.parsed;

    if (result.success && result.map_data) {
      return (
        <div className="my-4">
          <MapRenderer mapData={result.map_data} />
          <p className="text-label text-green-600 mt-2">
            {result.message}
          </p>
        </div>
      );
    }

    if (result.success && result.chart_data) {
      return (
        <div className="my-4">
          <ChartRenderer chartData={result.chart_data} />
          <p className="text-label text-green-600 mt-2">
            {result.message}
          </p>
        </div>
      );
    }

    return (
      <div className="my-4 p-3 bg-red-50 border border-red-200 rounded">
        <p className="text-red-600">{result.message}</p>
      </div>
    );
  }, [chartDataCache]);

  const handleCodeAgentDownload = async () => {
    if (downloadingCodeAgent) return
    setDownloadingCodeAgent(true)
    try {
      const authHeaders: Record<string, string> = {}
      try {
        const session = await fetchAuthSession()
        const token = session.tokens?.idToken?.toString()
        if (token) {
          authHeaders['Authorization'] = `Bearer ${token}`
          console.log('[CodeAgentDownload] auth token acquired')
        } else {
          console.warn('[CodeAgentDownload] fetchAuthSession succeeded but no idToken')
        }
      } catch (authErr) {
        console.error('[CodeAgentDownload] fetchAuthSession failed:', authErr)
      }

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
          } else {
            console.warn(`Skipped ${file.relativePath}: ${fileResponse.status}`)
          }
        } catch (e) {
          console.warn(`Failed to download ${file.relativePath}:`, e)
        }
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
      setDownloadingCodeAgent(false)
    }
  }

  const handleFilesDownload = async (toolUseId: string, toolName?: string, toolResult?: string) => {
    if (downloadingFiles.has(toolUseId)) return
    setDownloadingFiles(prev => new Set(prev).add(toolUseId))
    try {
      if (toolName === 'run_python_code' || toolName === 'finalize_document' && sessionId) {
        try {
          const filesListResponse = await fetch(getApiUrl(`files/list?toolUseId=${toolUseId}&sessionId=${sessionId}`));

          if (!filesListResponse.ok) {
            throw new Error(`Failed to get file list: ${filesListResponse.status}`);
          }

          const filesData = await filesListResponse.json();
          const filesList = filesData.files || [];

          if (filesList.length === 0) {
            throw new Error('No files found to download');
          }

          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();

          let filesAdded = 0;

          for (const fileName of filesList) {
            try {
              const fileUrl = getApiUrl(`output/sessions/${sessionId}/${toolUseId}/${fileName}`);
              const response = await fetch(fileUrl);

              if (response.ok) {
                const blob = await response.blob();
                zip.file(fileName, blob);
                filesAdded++;
              }
            } catch (e) {
              console.warn(`Failed to download ${fileName}:`, e);
            }
          }

          if (filesAdded === 0) {
            throw new Error('No files could be downloaded');
          }

          const zipBlob = await zip.generateAsync({ type: 'blob' });
          const objectUrl = URL.createObjectURL(zipBlob);
          const link = document.createElement('a');
          link.href = objectUrl;
          link.download = `python_execution_${toolUseId}.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(objectUrl);
          return;

        } catch (error) {
          console.error('Python MCP download failed:', error);
          if (error instanceof Error && error.message.includes('404')) {
            throw new Error('Download session expired. Please run the code again to generate new files.');
          }
          throw error;
        }
      }

      if (toolName === 'bedrock_code_interpreter' && toolResult) {
        try {
          const result = JSON.parse(toolResult);
          if (result.zip_download && result.zip_download.path) {
            const zipUrl = result.zip_download.path;
            const zipResponse = await fetch(zipUrl);
            if (zipResponse.ok) {
              const zipBlob = await zipResponse.blob();
              const objectUrl = URL.createObjectURL(zipBlob);
              const link = document.createElement('a');
              link.href = objectUrl;
              link.download = result.zip_download.name || `code_interpreter_${toolUseId}.zip`;
              link.style.display = 'none';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(objectUrl);
              return;
            }
          }
        } catch (e) {
          console.warn('ZIP download info not available or invalid');
        }

        try {
          const zipUrl = sessionId
            ? `/files/download/${sessionId}/${toolUseId}/code_interpreter_${toolUseId}.zip`
            : `/files/download/output/${toolUseId}/code_interpreter_${toolUseId}.zip`;

          const zipResponse = await fetch(zipUrl);
          if (zipResponse.ok) {
            const zipBlob = await zipResponse.blob();
            const objectUrl = URL.createObjectURL(zipBlob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = `code_interpreter_${toolUseId}.zip`;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(objectUrl);
            return;
          }
        } catch (e) {
          console.warn('Pre-made ZIP not available');
        }
      }

      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      const params = new URLSearchParams({ toolUseId });
      if (sessionId) {
        params.append('sessionId', sessionId);
      }

      const listResponse = await fetch(getApiUrl(`files/list?${params.toString()}`));

      if (!listResponse.ok) {
        throw new Error(`Failed to get file list: ${listResponse.status}`);
      }

      const { files } = await listResponse.json();

      if (!files || files.length === 0) {
        throw new Error('No files found to download');
      }

      let filesAdded = 0;

      for (const fileName of files) {
        try {
          const fileUrl = sessionId
            ? `/output/sessions/${sessionId}/${toolUseId}/${fileName}`
            : `/output/${toolUseId}/${fileName}`;

          const response = await fetch(fileUrl);

          if (response.ok) {
            if (fileName.endsWith('.py') || fileName.endsWith('.txt') || fileName.endsWith('.csv') || fileName.endsWith('.json')) {
              const content = await response.text();
              zip.file(fileName, content);
            } else {
              const blob = await response.blob();
              zip.file(fileName, blob);
            }
            filesAdded++;
          }
        } catch (e) {
          console.warn(`Failed to download ${fileName}:`, e);
          continue;
        }
      }

      if (filesAdded === 0) {
        throw new Error('No files could be downloaded');
      }

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      const objectUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `code_interpreter_${toolUseId}.zip`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);

    } catch (error) {
      console.error('Failed to create ZIP:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert(`Download failed: ${errorMessage}`);
    } finally {
      setDownloadingFiles(prev => {
        const next = new Set(prev)
        next.delete(toolUseId)
        return next
      })
    }
  };

  return (
    <>
      <div className="space-y-0.5">
        {toolExecutions.map((toolExecution) => {
          const isExpanded = isToolExpanded(toolExecution.id)
          const effectiveToolId = resolveEffectiveToolId(toolExecution.toolName, toolExecution.toolInput)
          const displayName = getToolDisplayName(toolExecution.toolName, toolExecution.isComplete, toolExecution.toolInput)
          const toolImageSrc = getToolImageSrc(effectiveToolId)
          const ToolIconComponent = !toolImageSrc ? getToolIcon(effectiveToolId) : null

          // Render visualization/map tools directly (including skill_executor results with chart/map data)
          if ((toolExecution.toolName === 'create_visualization' || toolExecution.toolName === 'show_on_map' || toolExecution.toolName === 'skill_executor') &&
              toolExecution.toolResult &&
              toolExecution.isComplete) {
            const chartResult = renderVisualizationResult(toolExecution.id);
            if (chartResult) {
              return (
                <div key={toolExecution.id} className="my-4">
                  {chartResult}
                </div>
              );
            }
          }

          return (
            <React.Fragment key={toolExecution.id}>
              <div>
                {/* Minimal header row */}
                <div
                  onClick={() => toggleToolExpansion(toolExecution.id)}
                  className="flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md hover:bg-muted/50 transition-colors w-full text-left group cursor-pointer"
                >
                  {toolImageSrc ? (
                    <img src={toolImageSrc} alt="" className="h-4 w-4 object-contain" />
                  ) : ToolIconComponent ? (
                    <ToolIconComponent className="h-4 w-4 text-muted-foreground" />
                  ) : null}
                  <span className="text-label text-foreground">
                    {displayName}
                  </span>
                  {/* Code agent: show latest step as inline status */}
                  {isCodeAgentExecution(toolExecution) &&
                    !toolExecution.isComplete &&
                    toolExecution.codeSteps &&
                    toolExecution.codeSteps.length > 0 && (
                    <span className="text-label text-muted-foreground truncate max-w-[240px]">
                      {'— '}
                      {toolExecution.codeSteps[toolExecution.codeSteps.length - 1].length > 45
                        ? toolExecution.codeSteps[toolExecution.codeSteps.length - 1].slice(0, 45) + '…'
                        : toolExecution.codeSteps[toolExecution.codeSteps.length - 1]}
                    </span>
                  )}
                  {toolExecution.isComplete ? (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="8" cy="8" r="7" fill="url(#checkGradient)" className="drop-shadow-sm" />
                      <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <defs>
                        <linearGradient id="checkGradient" x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse">
                          <stop offset="0%" stopColor="#10b981" />
                          <stop offset="100%" stopColor="#059669" />
                        </linearGradient>
                      </defs>
                    </svg>
                  ) : (
                    <span className="flex gap-0.5 ml-0.5">
                      <span className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" />
                      <span className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                    </span>
                  )}
                  {/* Download button for code tools */}
                  {(toolExecution.toolName === 'bedrock_code_interpreter' ||
                    toolExecution.toolName === 'run_python_code' ||
                    toolExecution.toolName === 'finalize_document') &&
                    toolExecution.isComplete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFilesDownload(toolExecution.id, toolExecution.toolName, toolExecution.toolResult);
                      }}
                      disabled={downloadingFiles.has(toolExecution.id)}
                      className="ml-auto p-1 hover:bg-muted rounded transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={downloadingFiles.has(toolExecution.id) ? "Downloading..." : "Download files"}
                    >
                      {downloadingFiles.has(toolExecution.id)
                        ? <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                        : <Download className="h-3.5 w-3.5 text-muted-foreground" />
                      }
                    </button>
                  )}
                  {/* Download workspace ZIP for code agent */}
                  {isCodeAgentExecution(toolExecution) &&
                    toolExecution.isComplete &&
                    !toolExecution.isCancelled && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCodeAgentDownload();
                      }}
                      disabled={downloadingCodeAgent}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-caption font-medium text-primary border border-primary/40 hover:border-primary hover:bg-primary/10 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={downloadingCodeAgent ? "Preparing ZIP..." : "Download workspace as ZIP"}
                    >
                      {downloadingCodeAgent
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Download className="h-3.5 w-3.5" />
                      }
                      <span>{downloadingCodeAgent ? 'Preparing...' : 'Download'}</span>
                    </button>
                  )}
                  {/* View in Canvas button for research_agent */}
                  {toolExecution.toolName === 'research_agent' &&
                    toolExecution.isComplete &&
                    !toolExecution.isCancelled &&
                    toolExecution.toolResult &&
                    !['user declined to proceed with research', 'user declined to proceed with browser automation']
                      .includes((toolExecution.toolResult || '').toLowerCase()) &&
                    onOpenResearchArtifact && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenResearchArtifact(toolExecution.id);
                      }}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-caption font-medium text-primary border border-primary/40 hover:border-primary hover:bg-primary/10 rounded-full transition-colors"
                      title="View in Canvas"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Canvas</span>
                    </button>
                  )}
                  {/* View in Canvas button for Word document tools */}
                  {(WORD_DOCUMENT_TOOLS.includes(toolExecution.toolName) ||
                    (toolExecution.toolName === 'skill_executor' && WORD_DOCUMENT_TOOLS.includes(toolExecution.toolInput?.tool_name))) &&
                    toolExecution.isComplete &&
                    !toolExecution.isCancelled &&
                    toolExecution.toolResult &&
                    extractWordFilename(toolExecution.toolResult, toolExecution.metadata) &&
                    onOpenWordArtifact && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const filename = extractWordFilename(toolExecution.toolResult || '', toolExecution.metadata);
                        if (filename) onOpenWordArtifact(filename);
                      }}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-caption font-medium text-primary border border-primary/40 hover:border-primary hover:bg-primary/10 rounded-full transition-colors"
                      title="View in Canvas"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Canvas</span>
                    </button>
                  )}
                  {/* View in Canvas button for Excel spreadsheet tools */}
                  {(EXCEL_SPREADSHEET_TOOLS.includes(toolExecution.toolName) ||
                    (toolExecution.toolName === 'skill_executor' && EXCEL_SPREADSHEET_TOOLS.includes(toolExecution.toolInput?.tool_name))) &&
                    toolExecution.isComplete &&
                    !toolExecution.isCancelled &&
                    toolExecution.toolResult &&
                    extractExcelFilename(toolExecution.toolResult, toolExecution.metadata) &&
                    onOpenExcelArtifact && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const filename = extractExcelFilename(toolExecution.toolResult || '', toolExecution.metadata);
                        if (filename) onOpenExcelArtifact(filename);
                      }}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-caption font-medium text-primary border border-primary/40 hover:border-primary hover:bg-primary/10 rounded-full transition-colors"
                      title="View in Canvas"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Canvas</span>
                    </button>
                  )}
                  {/* View in Canvas button for PowerPoint presentation tools */}
                  {(POWERPOINT_TOOLS.includes(toolExecution.toolName) ||
                    (toolExecution.toolName === 'skill_executor' && POWERPOINT_TOOLS.includes(toolExecution.toolInput?.tool_name))) &&
                    toolExecution.isComplete &&
                    !toolExecution.isCancelled &&
                    toolExecution.toolResult &&
                    extractPptFilename(toolExecution.toolResult, toolExecution.metadata) &&
                    onOpenPptArtifact && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const filename = extractPptFilename(toolExecution.toolResult || '', toolExecution.metadata);
                        if (filename) onOpenPptArtifact(filename);
                      }}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-caption font-medium text-primary border border-primary/40 hover:border-primary hover:bg-primary/10 rounded-full transition-colors"
                      title="View in Canvas"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Canvas</span>
                    </button>
                  )}
                  {/* View in Canvas button for browser_extract */}
                  {toolExecution.toolName === 'browser_extract' &&
                    toolExecution.isComplete &&
                    !toolExecution.isCancelled &&
                    toolExecution.toolResult &&
                    extractArtifactId(toolExecution.toolResult) &&
                    onOpenExtractedDataArtifact && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const artifactId = extractArtifactId(toolExecution.toolResult || '');
                        if (artifactId) onOpenExtractedDataArtifact(artifactId);
                      }}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-caption font-medium text-primary border border-primary/40 hover:border-primary hover:bg-primary/10 rounded-full transition-colors"
                      title="View in Canvas"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Canvas</span>
                    </button>
                  )}
                  {/* View in Canvas button for create_excalidraw_diagram (direct or via skill_executor) */}
                  {(toolExecution.toolName === 'create_excalidraw_diagram' ||
                    (toolExecution.toolName === 'skill_executor' && toolExecution.toolInput?.tool_name === 'create_excalidraw_diagram')) &&
                    toolExecution.isComplete &&
                    !toolExecution.isCancelled &&
                    toolExecution.toolResult &&
                    hasExcalidrawData(toolExecution.toolResult) &&
                    onOpenExcalidrawArtifact && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenExcalidrawArtifact(`excalidraw-${toolExecution.id}`);
                      }}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-caption font-medium text-primary border border-primary/40 hover:border-primary hover:bg-primary/10 rounded-full transition-colors"
                      title="View in Canvas"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Canvas</span>
                    </button>
                  )}
                </div>

                {/* Expanded detail section */}
                {isExpanded && (
                  <div className="ml-4 mt-1 mb-2 border-l-2 border-muted pl-3 space-y-2 animate-fade-in">
                    {/* Input parameters */}
                    {toolExecution.toolInput && Object.keys(toolExecution.toolInput).length > 0 && (
                      <div className="text-label">
                        <JsonDisplay
                          data={toolExecution.toolInput}
                          maxLines={4}
                          label="Input"
                        />
                      </div>
                    )}

                    {/* Reasoning (if present) */}
                    {toolExecution.reasoningText && toolExecution.reasoningText.trim() && (
                      <div className="text-label text-muted-foreground italic">
                        {toolExecution.reasoningText}
                      </div>
                    )}

                    {/* Code agent: step log (while running) */}
                    {isCodeAgentExecution(toolExecution) &&
                      !toolExecution.isComplete &&
                      toolExecution.codeSteps &&
                      toolExecution.codeSteps.length > 0 && (
                      <div className="space-y-0.5">
                        {toolExecution.codeSteps.slice(-6).map((step, i) => (
                          <div key={i} className="text-caption text-muted-foreground font-mono">
                            {step}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Code agent: todo checklist */}
                    {isCodeAgentExecution(toolExecution) &&
                      toolExecution.codeTodos &&
                      toolExecution.codeTodos.length > 0 && (
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

                    {/* Code agent: files changed (after complete) */}
                    {isCodeAgentExecution(toolExecution) &&
                      toolExecution.isComplete &&
                      toolExecution.codeResultMeta?.files_changed &&
                      toolExecution.codeResultMeta.files_changed.length > 0 && (
                      <div className="space-y-0.5">
                        <div className="text-caption text-muted-foreground mb-0.5">
                          {toolExecution.codeResultMeta.files_changed.length} file{toolExecution.codeResultMeta.files_changed.length !== 1 ? 's' : ''} changed
                          {toolExecution.codeResultMeta.steps > 0 && ` · ${toolExecution.codeResultMeta.steps} steps`}
                        </div>
                        {toolExecution.codeResultMeta.files_changed.map((f) => (
                          <div key={f} className="text-caption font-mono text-muted-foreground">
                            {f}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tool result */}
                    {toolExecution.toolResult && (() => {
                      // For code_agent, render the full JSON result
                      if (isCodeAgentExecution(toolExecution)) {
                        return (
                          <div className="text-label">
                            <JsonDisplay
                              data={toolExecution.toolResult}
                              maxLines={6}
                              label="Result"
                            />
                          </div>
                        )
                      }
                      return (
                        <div className="text-label">
                          {containsMarkdown(toolExecution.toolResult) ? (
                            <CollapsibleMarkdown sessionId={sessionId} maxLines={8}>
                              {toolExecution.toolResult}
                            </CollapsibleMarkdown>
                          ) : (
                            <JsonDisplay
                              data={toolExecution.toolResult}
                              maxLines={6}
                              label="Result"
                            />
                          )}
                        </div>
                      )
                    })()}

                    {/* Tool Images - Inside expanded section */}
                    {toolExecution.images && toolExecution.images.length > 0 && (
                      <div className="mt-2">
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                          {toolExecution.images
                            .filter((image) => {
                              const isUrlImage = 'type' in image && image.type === 'url';
                              const hasValidSource = isUrlImage
                                ? (image.thumbnail || image.url)
                                : ('data' in image && image.data);
                              return !!hasValidSource;
                            })
                            .slice(0, 5)
                            .map((image: ImageData, idx: number) => {
                              const isUrlImage = 'type' in image && image.type === 'url';

                              let imageSrc: string = '';
                              if (isUrlImage) {
                                imageSrc = image.url || image.thumbnail || '';
                              } else if ('data' in image && 'format' in image) {
                                const imageData = typeof image.data === 'string'
                                  ? image.data
                                  : btoa(String.fromCharCode(...new Uint8Array(image.data as ArrayBuffer)));
                                imageSrc = `data:image/${image.format};base64,${imageData}`;
                              }

                              let imageTitle: string = `Tool generated image ${idx + 1}`;
                              if (isUrlImage && 'title' in image && typeof image.title === 'string') {
                                imageTitle = image.title;
                              }

                              let imageFormat: string = 'IMG';
                              if (isUrlImage) {
                                imageFormat = 'WEB';
                              } else if ('format' in image && typeof image.format === 'string') {
                                imageFormat = image.format.toUpperCase();
                              }

                              const handleClick = () => {
                                if (isUrlImage && 'url' in image && image.url) {
                                  window.open(image.url, '_blank', 'noopener,noreferrer');
                                } else {
                                  setSelectedImage({ src: imageSrc, alt: imageTitle });
                                }
                              };

                              return (
                                <div key={idx} className="relative flex-shrink-0 h-[140px]">
                                  <div
                                    className="relative h-full rounded-lg overflow-hidden border border-border shadow-sm hover:shadow-lg transition-all duration-200 cursor-pointer bg-gray-50 dark:bg-gray-900"
                                    onClick={handleClick}
                                  >
                                    <LazyImage
                                      src={imageSrc}
                                      alt={imageTitle}
                                      className="h-full w-auto object-cover"
                                    />

                                    <div className="absolute top-2 right-2">
                                      <div className="text-[10px] font-medium bg-black/70 text-white backdrop-blur-sm px-1.5 py-0.5 rounded">
                                        {String(imageFormat)}
                                      </div>
                                    </div>

                                    {isUrlImage && 'title' in image && image.title && (
                                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6">
                                        <p className="text-[11px] font-medium text-white line-clamp-2 leading-tight max-w-[200px]">
                                          {image.title}
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </React.Fragment>
          )
        })}
      </div>

      {/* Image Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-8"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-[80vw] max-h-[80vh]">
            <img
              src={selectedImage.src}
              alt={selectedImage.alt}
              className="max-w-full max-h-[80vh] object-contain rounded-lg cursor-zoom-out"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  )
}, (prevProps, nextProps) => {
  if (prevProps.toolExecutions.length !== nextProps.toolExecutions.length) {
    return false
  }

  if (prevProps.compact !== nextProps.compact || prevProps.sessionId !== nextProps.sessionId) {
    return false
  }

  return prevProps.toolExecutions.every((tool, idx) => {
    const nextTool = nextProps.toolExecutions[idx]
    if (!nextTool) return false

    if (tool.id !== nextTool.id) return false
    if (tool.isComplete !== nextTool.isComplete) return false
    if (tool.toolResult !== nextTool.toolResult) return false

    const prevInput = JSON.stringify(tool.toolInput || {})
    const nextInput = JSON.stringify(nextTool.toolInput || {})
    if (prevInput !== nextInput) return false

    if ((tool.images?.length || 0) !== (nextTool.images?.length || 0)) return false
    if ((tool.codeSteps?.length || 0) !== (nextTool.codeSteps?.length || 0)) return false
    if (tool.codeResultMeta !== nextTool.codeResultMeta) return false
    if (JSON.stringify(tool.codeTodos) !== JSON.stringify(nextTool.codeTodos)) return false

    return true
  })
})
