'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Monitor, RefreshCw } from 'lucide-react';

interface BrowserLiveViewProps {
  sessionId: string;
  browserId: string;
  isActive: boolean;  // Controls DCV connection lifecycle
  onConnectionError?: () => void;
  onValidationFailed?: () => void;
}

declare global {
  interface Window {
    dcv?: any;
  }
}

export function BrowserLiveView({
  sessionId,
  browserId,
  isActive,
  onConnectionError,
  onValidationFailed,
}: BrowserLiveViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dcvLoaded, setDcvLoaded] = useState(false);
  const connectionRef = useRef<any>(null);
  const [currentLiveViewUrl, setCurrentLiveViewUrl] = useState<string | undefined>(undefined);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerIdRef = useRef(`dcv-display-${sessionId}-${Date.now()}`);

  // Load DCV Web Client SDK
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check if already loaded
    if (window.dcv) {
      setDcvLoaded(true);
      return;
    }

    // Load DCV SDK from local public folder
    const script = document.createElement('script');
    script.src = '/dcv-sdk/dcvjs-umd/dcv.js';
    script.async = true;
    script.onload = () => {
      console.log('[BrowserLiveView] DCV SDK loaded');

      // Set worker path to local DCV SDK
      if (window.dcv && window.dcv.setWorkerPath) {
        window.dcv.setWorkerPath(window.location.origin + '/dcv-sdk/dcvjs-umd/dcv/');
      }

      setDcvLoaded(true);
    };
    script.onerror = () => {
      setError('Failed to load DCV Web Client SDK');
      setLoading(false);
    };

    document.body.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  // Connect to Live View
  useEffect(() => {
    if (!isActive || !dcvLoaded || !sessionId || !browserId) return;

    let mounted = true;
    let connectionEstablished = false;

    async function connectToLiveView() {
      try {
        setLoading(true);
        setError(null);

        // Validate session first
        let validateUrl = `/api/browser/validate-session?sessionId=${encodeURIComponent(sessionId)}`;
        if (browserId) {
          validateUrl += `&browserId=${encodeURIComponent(browserId)}`;
        }

        try {
          const validateResponse = await fetch(validateUrl);
          const validateData = await validateResponse.json();

          if (!validateData.isValid) {
            console.log('[BrowserLiveView] Session not valid:', validateData.status || validateData.error);
            if (mounted) {
              onValidationFailed?.();
            }
            return;
          }
        } catch (validateError) {
          console.warn('[BrowserLiveView] Validation failed:', validateError);
          // Continue anyway - let DCV connection determine validity
        }

        // Get presigned URL from BFF
        let presignedUrl: string;
        try {
          const response = await fetch(
            `/api/browser/live-view?sessionId=${encodeURIComponent(sessionId)}&browserId=${encodeURIComponent(browserId)}`
          );

          if (response.ok) {
            const data = await response.json();
            if (data.presignedUrl) {
              presignedUrl = data.presignedUrl;
              setCurrentLiveViewUrl(presignedUrl);
            } else {
              throw new Error('BFF returned no URL');
            }
          } else {
            throw new Error(`BFF returned ${response.status}`);
          }
        } catch (bffError: any) {
          if (currentLiveViewUrl) {
            let fallbackUrl = currentLiveViewUrl;
            if (fallbackUrl.startsWith('wss://')) {
              fallbackUrl = fallbackUrl.replace('wss://', 'https://');
            }
            presignedUrl = fallbackUrl;
          } else {
            throw new Error('No live view URL available');
          }
        }

        if (!mounted) return;

        // Initialize DCV connection
        const dcv = window.dcv;
        if (!dcv) {
          throw new Error('DCV SDK not loaded');
        }

        // Reduce DCV logging noise
        dcv.setLogLevel(dcv.LogLevel.WARN);

        console.log('[BrowserLiveView] Connecting to browser session...');

        let authSuccessful = false;

        const httpExtraSearchParams = (method: any, url: any, body: any) => {
          const searchParams = new URL(presignedUrl).searchParams;
          return searchParams;
        };

        const containerId = containerIdRef.current;

        dcv.authenticate(presignedUrl, {
          promptCredentials: (authType: any, callback: any) => {
            callback(null, null);
          },
          httpExtraSearchParams: httpExtraSearchParams,
          success: (auth: any, result: any) => {
            if (!mounted) return;
            authSuccessful = true;

            if (result && result[0]) {
              const { sessionId: dcvSessionId, authToken } = result[0];

              dcv.connect({
                url: presignedUrl,
                sessionId: dcvSessionId,
                authToken: authToken,
                divId: containerId,
                baseUrl: window.location.origin + '/dcv-sdk/dcvjs-umd',
                observers: {
                  httpExtraSearchParams: httpExtraSearchParams,
                  displayLayout: (serverWidth: number, serverHeight: number) => {
                    const display = document.getElementById(containerId);
                    if (display && display.parentElement) {
                      const parent = display.parentElement;
                      const parentRect = parent.getBoundingClientRect();

                      const availableWidth = parentRect.width;
                      const availableHeight = parentRect.height;

                      const scaleX = availableWidth / serverWidth;
                      const scaleY = availableHeight / serverHeight;
                      const scale = Math.min(scaleX, scaleY);

                      display.style.width = `${serverWidth}px`;
                      display.style.height = `${serverHeight}px`;
                      display.style.transform = `scale(${scale})`;
                      display.style.transformOrigin = 'center center';
                      display.style.position = 'absolute';
                      display.style.left = '50%';
                      display.style.top = '50%';
                      display.style.marginLeft = `-${serverWidth / 2}px`;
                      display.style.marginTop = `-${serverHeight / 2}px`;

                      console.log(`[BrowserLiveView] Browser: ${serverWidth}x${serverHeight}, Scale: ${scale.toFixed(3)}`);
                    }
                  },
                  firstFrame: () => {
                    if (!mounted) return;
                    console.log('[BrowserLiveView] Connected successfully');
                    setLoading(false);

                    // Nova Act recommended resolution: 1600x900 (width 1280-1920, height 650-976)
                    if (connectionRef.current?.requestDisplayLayout) {
                      try {
                        const resizeDisplay = () => {
                          if (!connectionRef.current?.requestDisplayLayout) return;
                          connectionRef.current.requestDisplayLayout([{
                            name: "Main Display",
                            rect: {
                              x: 0,
                              y: 0,
                              width: 1600,
                              height: 900
                            },
                            primary: true
                          }]);
                        };

                        resizeDisplay();
                        setTimeout(resizeDisplay, 500);
                        setTimeout(resizeDisplay, 2000);
                      } catch (e) {
                        console.warn('[BrowserLiveView] Could not set display layout:', e);
                      }
                    }
                  },
                  error: (error: any) => {
                    console.error('[BrowserLiveView] Connection error:', error);
                    if (!mounted) return;
                    setError(`Connection error: ${error.message || 'Unknown error'}`);
                    setLoading(false);
                    onConnectionError?.();
                  },
                },
              })
                .then((conn: any) => {
                  if (!mounted) return;
                  connectionRef.current = conn;
                  connectionEstablished = true;
                })
                .catch((error: any) => {
                  if (!mounted) return;
                  console.error('[BrowserLiveView] Connection failed:', error);
                  setError(`Connection failed: ${error.message || 'Unknown error'}`);
                  setLoading(false);
                  onConnectionError?.();
                });
            } else {
              console.error('[BrowserLiveView] No session data in auth result');
              setError('Authentication succeeded but no session data received');
              setLoading(false);
            }
          },
          error: (auth: any, error: any) => {
            if (authSuccessful || !mounted) return;

            console.error('[BrowserLiveView] Authentication failed:', error);

            let errorMessage = 'Unknown authentication error';
            if (error?.message) {
              errorMessage = error.message;
            } else if (error?.code) {
              errorMessage = `Error code ${error.code}`;
            }

            setError(`Authentication failed: ${errorMessage}`);
            setLoading(false);
            onConnectionError?.();
          },
        });

      } catch (error: any) {
        if (!mounted) return;
        console.error('[BrowserLiveView] Failed to connect:', error);
        setError(error.message || 'Unknown error');
        setLoading(false);
        onConnectionError?.();
      }
    }

    connectToLiveView();

    return () => {
      mounted = false;
      if (connectionRef.current && connectionEstablished) {
        try {
          const conn = connectionRef.current;
          connectionRef.current = null;

          if (conn && typeof conn.disconnect === 'function') {
            console.log('[BrowserLiveView] Disconnecting...');
            conn.disconnect();
          }

          const container = document.getElementById(containerIdRef.current);
          if (container) {
            container.innerHTML = '';
          }
        } catch (e) {
          // Suppress DCV SDK cleanup errors
        }
      }
    };
  }, [isActive, dcvLoaded, sessionId, browserId, onConnectionError, onValidationFailed]);

  // Auto-rescale display when container size changes
  useEffect(() => {
    if (!isActive) return;

    const handleResize = () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }

      resizeTimeoutRef.current = setTimeout(() => {
        const display = document.getElementById(containerIdRef.current);

        if (display && display.parentElement) {
          // Nova Act recommended resolution: 1600x900
          const browserWidth = parseInt(display.style.width) || 1600;
          const browserHeight = parseInt(display.style.height) || 900;

          const parent = display.parentElement;
          const parentRect = parent.getBoundingClientRect();

          const availableWidth = parentRect.width;
          const availableHeight = parentRect.height;

          const scaleX = availableWidth / browserWidth;
          const scaleY = availableHeight / browserHeight;
          const scale = Math.min(scaleX, scaleY);

          display.style.transform = `scale(${scale})`;
          display.style.transformOrigin = 'center center';
          display.style.position = 'absolute';
          display.style.left = '50%';
          display.style.top = '50%';
          display.style.marginLeft = `-${browserWidth / 2}px`;
          display.style.marginTop = `-${browserHeight / 2}px`;
        }
      }, 300);
    };

    window.addEventListener('resize', handleResize);

    // Also observe container resize
    const resizeObserver = new ResizeObserver(handleResize);
    const container = containerRef.current?.parentElement;
    if (container) {
      resizeObserver.observe(container);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, [isActive]);

  // Retry connection
  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    // Force re-render by updating dcvLoaded
    setDcvLoaded(false);
    setTimeout(() => setDcvLoaded(!!window.dcv), 100);
  }, []);

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-sidebar-border/50 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Monitor className="w-4 h-4 text-sidebar-foreground/70" />
          <span className="text-label font-medium text-sidebar-foreground">Browser View</span>
          {!loading && !error && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-green-500/10 dark:bg-green-400/10 rounded">
              <div className="w-1.5 h-1.5 bg-green-500 dark:bg-green-400 rounded-full animate-pulse" />
              <span className="text-[10px] font-medium text-green-600 dark:text-green-400">LIVE</span>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 backdrop-blur-sm z-10">
            <div className="text-center">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
                <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-blue-400 rounded-full animate-ping mx-auto opacity-20"></div>
              </div>
              <p className="text-slate-200 font-medium">Connecting to browser session...</p>
              <p className="text-slate-400 text-label mt-1">Please wait</p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 backdrop-blur-sm z-10">
            <div className="text-center max-w-md px-6">
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-heading font-semibold text-red-400 mb-2">Connection Failed</p>
              <p className="text-label text-slate-300 mb-4">{error}</p>
              <Button
                variant="outline"
                className="bg-slate-800 hover:bg-slate-700 text-white border-slate-600"
                onClick={handleRetry}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </div>
          </div>
        )}

        <div
          id={containerIdRef.current}
          ref={containerRef}
          style={{
            backgroundColor: '#000'
          }}
        />
      </div>
    </div>
  );
}
