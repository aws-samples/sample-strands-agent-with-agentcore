import React, { useState, useCallback, useMemo } from 'react'
import { ChevronRight, Download, ChevronDown, ChevronUp } from 'lucide-react'
import { ToolExecution } from '@/types/chat'
import { getToolDisplayName } from '@/utils/chat'
import { ChartRenderer } from '@/components/ChartRenderer'
import { ChartToolResult } from '@/types/chart'
import { MapRenderer } from '@/components/MapRenderer'
import { MapToolResult } from '@/types/map'
import { JsonDisplay } from '@/components/ui/JsonDisplay'
import { Markdown } from '@/components/ui/Markdown'
import { LazyImage } from '@/components/ui/LazyImage'
import { getApiUrl } from '@/config/environment'
import { cn } from '@/lib/utils'
import type { ImageData } from '@/utils/imageExtractor'

interface ToolExecutionContainerProps {
  toolExecutions: ToolExecution[]
  compact?: boolean
  availableTools?: Array<{
    id: string
    name: string
    tool_type?: string
  }>
  sessionId?: string
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

export const ToolExecutionContainer = React.memo<ToolExecutionContainerProps>(({ toolExecutions, compact = false, availableTools = [], sessionId }) => {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null)

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
      if ((deps.toolName === 'create_visualization' || deps.toolName === 'show_on_map') &&
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

  const handleFilesDownload = async (toolUseId: string, toolName?: string, toolResult?: string) => {
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
    }
  };

  return (
    <>
      <div className="space-y-0.5">
        {toolExecutions.map((toolExecution) => {
          const isExpanded = isToolExpanded(toolExecution.id)
          const displayName = getToolDisplayName(toolExecution.toolName, toolExecution.isComplete)

          // Render visualization/map tools directly
          if ((toolExecution.toolName === 'create_visualization' || toolExecution.toolName === 'show_on_map') &&
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
                <button
                  onClick={() => toggleToolExpansion(toolExecution.id)}
                  className="flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md hover:bg-muted/50 transition-colors w-full text-left group"
                >
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform duration-200",
                      isExpanded && "rotate-90"
                    )}
                  />
                  <span className="text-label text-foreground">
                    {displayName}
                  </span>
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
                      className="ml-auto p-1 hover:bg-muted rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="Download files"
                    >
                      <Download className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </button>

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

                    {/* Tool result */}
                    {toolExecution.toolResult && (
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
                    )}
                  </div>
                )}
              </div>

              {/* Tool Images */}
              {toolExecution.images && toolExecution.images.length > 0 && (
                <div className="mt-3 mb-2">
                  <div className="space-y-3">
                    {toolExecution.images
                      .filter((image) => {
                        const isUrlImage = 'type' in image && image.type === 'url';
                        const hasValidSource = isUrlImage
                          ? (image.thumbnail || image.url)
                          : ('data' in image && image.data);
                        return !!hasValidSource;
                      })
                      .slice(0, 3)
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
                          <div key={idx} className="relative w-full">
                            <div
                              className="relative rounded-xl overflow-hidden border border-border shadow-md hover:shadow-xl transition-all duration-200 cursor-pointer bg-gray-50 dark:bg-gray-900"
                              onClick={handleClick}
                            >
                              <LazyImage
                                src={imageSrc}
                                alt={imageTitle}
                                className="w-full h-auto object-contain"
                              />

                              <div className="absolute top-3 right-3">
                                <div className="text-caption font-semibold bg-black/80 text-white border-0 backdrop-blur-sm px-2.5 py-1 rounded inline-block">
                                  {String(imageFormat)}
                                </div>
                              </div>

                              {isUrlImage && 'title' in image && image.title && (
                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/60 to-transparent p-4 pt-8">
                                  <p className="text-label font-medium text-white line-clamp-2 leading-tight">
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
            </React.Fragment>
          )
        })}
      </div>

      {/* Image Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative" style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={selectedImage.src}
              alt={selectedImage.alt}
              className="object-contain cursor-zoom-out rounded-lg"
              style={{ maxWidth: 'min(90vw, 150%)', maxHeight: '85vh' }}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute -top-3 -right-3 bg-white/90 hover:bg-white text-gray-800 rounded-full p-1.5 shadow-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

    return true
  })
})
