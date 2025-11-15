import React, { useState, useCallback, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { ChevronRight, Zap, Brain, CheckCircle, Clock, TrendingUp, Download } from 'lucide-react'
import { ToolExecution } from '@/types/chat'
import { getToolIconById } from '@/utils/chat'
import { ChartRenderer } from '@/components/ChartRenderer'
import { ChartToolResult } from '@/types/chart'
import { JsonDisplay } from '@/components/ui/JsonDisplay'
import { Markdown } from '@/components/ui/Markdown'
import { getApiUrl } from '@/config/environment'

interface ToolExecutionContainerProps {
  toolExecutions: ToolExecution[]
  compact?: boolean // For use within message containers
  availableTools?: Array<{
    id: string
    name: string
    tool_type?: string
  }>
  sessionId?: string // Add session ID prop
}


export const ToolExecutionContainer: React.FC<ToolExecutionContainerProps> = ({ toolExecutions, compact = false, availableTools = [], sessionId }) => {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null)

  // Helper to detect if content contains markdown links or formatting
  const containsMarkdown = (text: string): boolean => {
    if (typeof text !== 'string') return false
    // Check for markdown links: [text](url) or **bold** or other markdown syntax
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


  const isToolExpanded = (toolId: string, toolExecution: ToolExecution) => {
    // Only expand if user manually clicked to expand
    return expandedTools.has(toolId)
  }


  if (!toolExecutions || toolExecutions.length === 0) {
    return null
  }

  // Memoize parsed chart data to prevent re-renders during streaming
  const chartDataCache = useMemo(() => {
    const cache = new Map<string, { parsed: ChartToolResult, resultString: string }>();

    toolExecutions.forEach(toolExecution => {
      if (toolExecution.toolName === 'create_visualization' &&
          toolExecution.toolResult &&
          toolExecution.isComplete) {
        try {
          const parsed = JSON.parse(toolExecution.toolResult);
          cache.set(toolExecution.id, {
            parsed,
            resultString: toolExecution.toolResult
          });
        } catch (e) {
          // Invalid JSON, skip
        }
      }
    });

    return cache;
  }, [toolExecutions.map(t => t.id + ':' + t.isComplete + ':' + (t.toolResult || '')).join('|')]);

  // Helper function to render visualization tool result
  const renderVisualizationResult = useCallback((toolUseId: string) => {
    const cached = chartDataCache.get(toolUseId);
    if (!cached) return null;

    const result = cached.parsed;

    if (result.success && result.chart_data) {
      // Direct rendering with chart data
      return (
        <div className="my-4">
          <ChartRenderer chartData={result.chart_data} />
          <p className="text-sm text-green-600 mt-2">
            {result.message}
          </p>
        </div>
      );
    } else if (result.success && result.chart_id) {
      // Fallback to API lookup for backward compatibility
      return (
        <div className="my-4">
          <ChartRenderer
            chartId={result.chart_id}
            sessionId={sessionId}
            toolUseId={toolUseId}
          />
          <p className="text-sm text-green-600 mt-2">
            {result.message}
          </p>
        </div>
      );
    } else {
      return (
        <div className="my-4 p-3 bg-red-50 border border-red-200 rounded">
          <p className="text-red-600">{result.message}</p>
        </div>
      );
    }
  }, [chartDataCache, sessionId]);

  // Helper function to handle ZIP download
  const handleFilesDownload = async (toolUseId: string, toolName?: string, toolResult?: string) => {
    try {
      // Handle Python MCP downloads
      if (toolName === 'run_python_code' || toolName === 'finalize_document' && sessionId) {
        try {
          // Get list of all files in the session directory for this tool execution
          const filesListResponse = await fetch(getApiUrl(`files/list?toolUseId=${toolUseId}&sessionId=${sessionId}`));
          
          if (!filesListResponse.ok) {
            throw new Error(`Failed to get file list: ${filesListResponse.status}`);
          }
          
          const filesData = await filesListResponse.json();
          const filesList = filesData.files || [];
          
          if (filesList.length === 0) {
            throw new Error('No files found to download');
          }
          
          // Import JSZip dynamically
          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();
          
          let filesAdded = 0;
          
          // Download each file from backend session directory using static file serving
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
          
          // Generate and download ZIP
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
          // Check if it's a 404 error (session expired)
          if (error instanceof Error && error.message.includes('404')) {
            throw new Error('Download session expired. Please run the code again to generate new files.');
          }
          throw error;
        }
      }
      
      // For Bedrock Code Interpreter, try to use the zip_download info from tool result first
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
          console.warn('ZIP download info not available or invalid, falling back to manual path');
        }
        
        // Fallback: try hardcoded path
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
          console.warn('Pre-made ZIP not available, falling back to individual files');
        }
      }
      
      // Fallback: create ZIP from individual files
      // Import JSZip dynamically
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      
      // Get actual file list from backend API
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
      const addedFiles: string[] = [];
      
      // Download each file that actually exists
      for (const fileName of files) {
        try {
          const fileUrl = sessionId 
            ? `/output/sessions/${sessionId}/${toolUseId}/${fileName}`
            : `/output/${toolUseId}/${fileName}`;
          
          const response = await fetch(fileUrl);
          
          if (response.ok) {
            if (fileName.endsWith('.py') || fileName.endsWith('.txt') || fileName.endsWith('.csv') || fileName.endsWith('.json')) {
              // Text files
              const content = await response.text();
              zip.file(fileName, content);
            } else {
              // Binary files (images, etc.)
              const blob = await response.blob();
              zip.file(fileName, blob);
            }
            filesAdded++;
            addedFiles.push(fileName);
          }
        } catch (e) {
          console.warn(`Failed to download ${fileName}:`, e);
          continue;
        }
      }
      
      if (filesAdded === 0) {
        throw new Error('No files could be downloaded');
      }
      
      // Generate and download ZIP
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
      
      // Clean up object URL
      URL.revokeObjectURL(objectUrl);
      
    } catch (error) {
      console.error('Failed to create ZIP:', error);
      // Fallback: download just the Python script
      try {
        await handleScriptDownload(toolUseId);
      } catch (fallbackError) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        alert(`Download failed: ${errorMessage}`);
      }
    }
  };

  // Fallback function to download script file directly
  const handleScriptDownload = async (toolUseId: string) => {
    try {
      // Use session-specific path if sessionId is available, otherwise fallback to old path
      const scriptUrl = sessionId 
        ? `/output/sessions/${sessionId}/${toolUseId}/script_001.py`
        : `/output/${toolUseId}/script_001.py`;
      const scriptResponse = await fetch(scriptUrl);
      
      if (scriptResponse.ok) {
        const scriptBlob = await scriptResponse.blob();
        const objectUrl = URL.createObjectURL(scriptBlob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `script_001_${toolUseId}.py`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up object URL
        URL.revokeObjectURL(objectUrl);
        
        alert('Could not create ZIP. Downloaded Python script only.');
      } else {
        throw new Error('Script file not found');
      }
    } catch (error) {
      throw new Error('Failed to download files');
    }
  };


  return (
    <>
      <div className={compact ? "space-y-1" : "mb-4 space-y-1"}>
      {toolExecutions.map((toolExecution) => {
        const IconComponent = getToolIconById(toolExecution.toolName)
        const isExpanded = isToolExpanded(toolExecution.id, toolExecution)

        // Check if this is a visualization tool and render chart directly
        if (toolExecution.toolName === 'create_visualization' && toolExecution.toolResult && toolExecution.isComplete) {
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
          <div key={toolExecution.id} className={`${
            compact 
              ? "bg-card/80 rounded-md border border-border/60" 
              : "bg-card/80 rounded-md border border-border shadow-sm"
          } overflow-hidden`} style={{ maxWidth: '100%', width: '100%' }}>
            {/* Tool Header - More Compact */}
            <button
              onClick={() => toggleToolExpansion(toolExecution.id)}
              className={`w-full ${compact ? "px-3 py-2" : "px-3 py-2.5"} flex items-center justify-between hover:bg-muted/50 transition-colors`}
            >
              <div className="flex items-center gap-2">
                <div className="p-1 bg-primary/10 rounded border border-primary/20">
                  <IconComponent className="h-3 w-3 text-primary" />
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium text-xs text-foreground">{toolExecution.toolName}</p>
                    {toolExecution.isComplete ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : (
                      <Clock className="h-3 w-3 text-primary animate-pulse" />
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-xs px-1.5 py-0.5 bg-background/70 text-primary border-primary/30">
                  {toolExecution.isComplete ? 'Completed' : 'Running'}
                </Badge>
                <ChevronRight 
                  className="h-3 w-3 text-muted-foreground transition-transform" 
                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                />
              </div>
            </button>

            {/* Tool Content */}
            {isExpanded && (
              <div className={`border-t ${compact ? "border-border/60 bg-background/50" : "border-primary/20 bg-background/70"} backdrop-blur-sm`}>
                <div className={`${compact ? "p-3" : "p-4"} min-w-0 max-w-full overflow-hidden`}>
                  {/* Tool Input */}
                  {toolExecution.toolInput !== undefined && (
                    <div className={compact ? "mb-4" : "mb-6"}>
                      <div className="flex items-center gap-2 mb-3">
                        <Zap className="h-4 w-4 text-primary" />
                        <h4 className="text-sm font-semibold text-foreground">Input Parameters</h4>
                      </div>
                      {toolExecution.toolInput && Object.keys(toolExecution.toolInput).length > 0 ? (
                        <div className="bg-background rounded-lg border border-border" style={{ maxWidth: '100%', width: '100%' }}>
                          <div className="p-3" style={{ maxWidth: '100%', overflow: 'hidden' }}>
                            <JsonDisplay 
                              data={toolExecution.toolInput}
                              maxLines={6}
                              label="Parameters"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="bg-background rounded-lg border border-border p-3" style={{ maxWidth: '100%', width: '100%' }}>
                          <div className="text-sm text-muted-foreground italic">
                            No input parameters (this tool takes no arguments)
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Reasoning Process */}
                  {toolExecution.reasoningText && toolExecution.reasoningText.trim() && (
                    <div className={compact ? "mb-4" : "mb-6"}>
                      <div className="flex items-center gap-2 mb-3">
                        <Brain className="h-4 w-4 text-secondary" />
                        <h4 className="text-sm font-semibold text-foreground">AI Reasoning Process</h4>
                      </div>
                      <div className="bg-background rounded-lg border-l-4 border-secondary" style={{ maxWidth: '100%', width: '100%' }}>
                        <div className="p-3" style={{ maxWidth: '100%', overflow: 'hidden' }}>
                          <JsonDisplay 
                            data={toolExecution.reasoningText}
                            maxLines={5}
                            label="Reasoning"
                          />
                        </div>
                      </div>
                    </div>
                  )}


                  {/* Tool Result */}
                  {toolExecution.toolResult && (
                    <div className={compact ? "mb-4" : "mb-6"}>
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <h4 className="text-sm font-semibold text-foreground">Tool Result</h4>
                        {(toolExecution.toolName === 'bedrock_code_interpreter' || toolExecution.toolName === 'run_python_code' || toolExecution.toolName === 'finalize_document') && toolExecution.isComplete && (
                          <button
                            onClick={() => handleFilesDownload(toolExecution.id, toolExecution.toolName, toolExecution.toolResult)}
                            className="ml-auto p-1.5 hover:bg-muted rounded transition-colors flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            title="Download all files as ZIP"
                          >
                            <Download className="h-3 w-3" />
                            <span>Download Files</span>
                          </button>
                        )}
                      </div>
                      <div className="bg-background rounded-lg border-l-4 border-green-500/30 dark:border-green-400/30" style={{ maxWidth: '100%', width: '100%' }}>
                        <div className="p-3" style={{ maxWidth: '100%', overflow: 'hidden' }}>
                          {containsMarkdown(toolExecution.toolResult) ? (
                            <Markdown size="sm" sessionId={sessionId}>{toolExecution.toolResult}</Markdown>
                          ) : (
                            <JsonDisplay
                              data={toolExecution.toolResult}
                              maxLines={8}
                              label="Tool Result"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tool Images */}
                  {toolExecution.images && toolExecution.images.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <h4 className="text-sm font-semibold text-foreground">Generated Images</h4>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {toolExecution.images.map((image, idx) => {
                          const imageSrc = `data:image/${image.format};base64,${typeof image.data === 'string' ? image.data : btoa(String.fromCharCode(...new Uint8Array(image.data)))}`;
                          return (
                            <div key={idx} className="relative group">
                              <img
                                src={imageSrc}
                                alt={`Tool generated image ${idx + 1}`}
                                className="w-full h-auto rounded-lg border border-border shadow-sm cursor-pointer hover:shadow-lg transition-shadow"
                                style={{ maxHeight: '325px', objectFit: 'contain' }}
                                onClick={() => setSelectedImage({ src: imageSrc, alt: `Tool generated image ${idx + 1}` })}
                              />
                              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Badge variant="secondary" className="text-xs bg-black/70 text-white border-0">
                                  {image.format.toUpperCase()}
                                </Badge>
                              </div>
                              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-lg pointer-events-none">
                                <div className="bg-background/90 px-2 py-1 rounded text-xs font-medium text-foreground">
                                  Click to enlarge
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
      </div>

      {/* Image Modal */}
      {selectedImage && (
        <div 
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img
              src={selectedImage.src}
              alt={selectedImage.alt}
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="absolute bottom-4 left-4 bg-black/50 text-white px-3 py-1 rounded text-sm">
              {selectedImage.alt}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
