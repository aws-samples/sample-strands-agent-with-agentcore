'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Monitor } from 'lucide-react';

// Note: Error filtering for DCV SDK is handled globally in /public/error-filter.js

interface BrowserLiveViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  browserId: string | null;
}

declare global {
  interface Window {
    dcv?: any;
  }
}

export function BrowserLiveViewModal({
  isOpen,
  onClose,
  sessionId,
  browserId,
}: BrowserLiveViewModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dcvLoaded, setDcvLoaded] = useState(false);
  const connectionRef = useRef<any>(null);
  const [currentLiveViewUrl, setCurrentLiveViewUrl] = useState<string | undefined>(undefined);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    script.src = '/dcv-sdk/dcvjs-umd/dcv.js';  // Local hosted DCV SDK
    script.async = true;
    script.onload = () => {
      console.log('DCV SDK loaded from local');

      // Set worker path to local DCV SDK
      if (window.dcv && window.dcv.setWorkerPath) {
        window.dcv.setWorkerPath(window.location.origin + '/dcv-sdk/dcvjs-umd/dcv/');
        console.log('DCV worker path set to:', window.location.origin + '/dcv-sdk/dcvjs-umd/dcv/');
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
    console.log('[BrowserLiveViewModal] useEffect triggered:', { isOpen, dcvLoaded, sessionId, browserId });
    if (!isOpen || !dcvLoaded || !sessionId || !browserId) return;

    // TypeScript type narrowing - both sessionId and browserId are guaranteed to be non-null here
    const validSessionId: string = sessionId;
    const validBrowserId: string = browserId;

    let mounted = true;
    let connectionEstablished = false;

    async function connectToLiveView() {
      try {
        setLoading(true);
        setError(null);

        // Get fresh URL from BFF or use existing URL from metadata
        let presignedUrl: string;

        // Try to get fresh URL from BFF (auto-refresh capability)
        try {
          const response = await fetch(
            `/api/browser/live-view?sessionId=${encodeURIComponent(validSessionId)}&browserId=${encodeURIComponent(validBrowserId)}`
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
          // Fallback to liveViewUrl from metadata (without expiration check)
          // Note: BFF refresh is the primary method, fallback is secondary
          if (currentLiveViewUrl) {
            // Convert legacy WSS URLs to HTTPS (for backward compatibility)
            let fallbackUrl = currentLiveViewUrl;
            if (fallbackUrl.startsWith('wss://')) {
              fallbackUrl = fallbackUrl.replace('wss://', 'https://');
            }

            presignedUrl = fallbackUrl;
          } else {
            throw new Error(
              'No live view URL available and BFF refresh failed. Please run a browser tool first (browser_navigate, browser_act, or browser_extract).'
            );
          }
        }

        if (!mounted) return;

        // Initialize DCV connection
        const dcv = window.dcv;
        if (!dcv) {
          throw new Error('DCV SDK not loaded');
        }

        // Reduce DCV logging noise - suppress all logs except critical errors
        // WARN level filters out networkMonitor errors while keeping critical issues
        dcv.setLogLevel(dcv.LogLevel.WARN);

        console.log('[DCV] Connecting to browser session...');

        // Flag to track successful authentication (DCV SDK may call error callback even after success)
        let authSuccessful = false;

        // Callback to inject AWS SigV4 query parameters for all DCV requests
        const httpExtraSearchParams = (method: any, url: any, body: any) => {
          // Return query parameters from presigned URL
          const searchParams = new URL(presignedUrl).searchParams;
          return searchParams;
        };

        // Authenticate first, then connect - following AWS reference implementation
        dcv.authenticate(presignedUrl, {
          promptCredentials: (authType: any, callback: any) => {
            // Credentials are in the presigned URL query params
            callback(null, null);
          },
          httpExtraSearchParams: httpExtraSearchParams,
          success: (auth: any, result: any) => {
            if (!mounted) return;
            authSuccessful = true; // Mark authentication as successful

            if (result && result[0]) {
              const { sessionId: dcvSessionId, authToken } = result[0];

              // Connect using the authenticated session
              dcv.connect({
                url: presignedUrl,
                sessionId: dcvSessionId,
                authToken: authToken,
                divId: 'dcv-display-container',
                baseUrl: window.location.origin + '/dcv-sdk/dcvjs-umd',
                observers: {
                  httpExtraSearchParams: httpExtraSearchParams,
                  displayLayout: (serverWidth: number, serverHeight: number) => {
                    // Scale the display to fill the modal container
                    const display = document.getElementById('dcv-display-container');
                    if (display && display.parentElement) {
                      // Get actual parent container dimensions
                      const parent = display.parentElement;
                      const parentRect = parent.getBoundingClientRect();

                      const availableWidth = parentRect.width;
                      const availableHeight = parentRect.height;

                      // Calculate scale to fill container
                      const scaleX = availableWidth / serverWidth;
                      const scaleY = availableHeight / serverHeight;
                      const scale = Math.min(scaleX, scaleY);

                      const scaledWidth = serverWidth * scale;
                      const scaledHeight = serverHeight * scale;

                      // Position display absolutely and center it
                      display.style.width = `${serverWidth}px`;
                      display.style.height = `${serverHeight}px`;
                      display.style.transform = `scale(${scale})`;
                      display.style.transformOrigin = 'center center';
                      display.style.position = 'absolute';
                      display.style.left = '50%';
                      display.style.top = '50%';
                      display.style.marginLeft = `-${serverWidth / 2}px`;
                      display.style.marginTop = `-${serverHeight / 2}px`;

                      console.log(`[DCV] Browser: ${serverWidth}x${serverHeight}, Container: ${availableWidth.toFixed(0)}x${availableHeight.toFixed(0)}, Scale: ${scale.toFixed(3)}`);
                    }
                  },
                  firstFrame: () => {
                    if (!mounted) return;
                    console.log('[DCV] Connected successfully');
                    setLoading(false);

                    // Keep browser at 1536×1296 (Nova Act optimal range: 1536-2304 width, 864-1296 height)
                    // Scaling is handled by displayLayout callback
                    // Request display layout to ensure proper size
                    if (connectionRef.current?.requestDisplayLayout) {
                      try {
                        const resizeDisplay = () => {
                          connectionRef.current.requestDisplayLayout([{
                            name: "Main Display",
                            rect: {
                              x: 0,
                              y: 0,
                              width: 1536,
                              height: 1296
                            },
                            primary: true
                          }]);
                        };

                        // Request multiple times for DCV SDK reliability
                        resizeDisplay();
                        setTimeout(resizeDisplay, 500);
                        setTimeout(resizeDisplay, 2000);

                        console.log('[DCV] Browser resolution set to 1536×1296');
                      } catch (e) {
                        console.warn('[DCV] Could not set display layout:', e);
                      }
                    }
                  },
                  error: (error: any) => {
                    console.error('[DCV] Connection error:', error);
                    if (!mounted) return;
                    setError(`Connection error: ${error.message || 'Unknown error'}`);
                    setLoading(false);
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
                  console.error('[DCV] Connection failed:', error);
                  setError(`Connection failed: ${error.message || 'Unknown error'}`);
                  setLoading(false);
                });
            } else {
              console.error('[DCV] No session data in auth result');
              setError('Authentication succeeded but no session data received');
              setLoading(false);
            }
          },
          error: (auth: any, error: any) => {
            // IMPORTANT: Ignore error if authentication was already successful
            // DCV SDK may call error callback even after successful authentication (SDK bug)
            if (authSuccessful || !mounted) {
              return;
            }

            console.error('[DCV] Authentication failed:', error);

            let errorMessage = 'Unknown authentication error';
            if (error?.message) {
              errorMessage = error.message;
            } else if (error?.code) {
              errorMessage = `Error code ${error.code}`;
            }

            setError(`Authentication failed: ${errorMessage}`);
            setLoading(false);
          },
        });

      } catch (error: any) {
        if (!mounted) return;
        console.error('Failed to connect to live view:', error);
        setError(error.message || 'Unknown error');
        setLoading(false);
      }
    }

    connectToLiveView();

    return () => {
      mounted = false;
      // Only disconnect if connection was actually established
      // This prevents premature disconnection during React Strict Mode double-mounting
      if (connectionRef.current && connectionEstablished) {
        try {
          const conn = connectionRef.current;
          connectionRef.current = null; // Clear ref first to prevent race conditions

          if (conn && typeof conn.disconnect === 'function') {
            // KNOWN ISSUE: DCV SDK disconnect causes "Close received after close" errors
            // This is a DCV SDK bug where multiple modules try to close the same WebSocket
            // These errors are:
            // - Emitted by browser's WebSocket API (not JavaScript console.error)
            // - Cannot be suppressed via JavaScript
            // - Harmless (no functional impact or memory leaks)
            // - Will appear in console but can be safely ignored
            console.log('[DCV] Disconnecting (expect harmless WebSocket close errors)...');

            conn.disconnect();
          }

          // Clear the DCV display container to remove any lingering event handlers
          const container = document.getElementById('dcv-display-container');
          if (container) {
            container.innerHTML = '';
          }
        } catch (e) {
          // Suppress DCV SDK cleanup errors - they're expected during disconnect
        }
      }
    };
  }, [isOpen, dcvLoaded, sessionId, browserId]);

  // Auto-rescale display when window size changes
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = () => {
      // Debounce resize events
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }

      resizeTimeoutRef.current = setTimeout(() => {
        const display = document.getElementById('dcv-display-container');

        if (display && display.parentElement) {
          // Get current browser resolution from display element
          const browserWidth = parseInt(display.style.width) || 1536;
          const browserHeight = parseInt(display.style.height) || 1296;

          // Get actual parent container dimensions
          const parent = display.parentElement;
          const parentRect = parent.getBoundingClientRect();

          const availableWidth = parentRect.width;
          const availableHeight = parentRect.height;

          // Calculate scale to fit
          const scaleX = availableWidth / browserWidth;
          const scaleY = availableHeight / browserHeight;
          const scale = Math.min(scaleX, scaleY);

          // Apply new scale with center positioning
          display.style.transform = `scale(${scale})`;
          display.style.transformOrigin = 'center center';
          display.style.position = 'absolute';
          display.style.left = '50%';
          display.style.top = '50%';
          display.style.marginLeft = `-${browserWidth / 2}px`;
          display.style.marginTop = `-${browserHeight / 2}px`;

          console.log(`[DCV] Window resized, rescaling to ${scale.toFixed(3)}`);
        }
      }, 300); // Debounce 300ms
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="!max-w-none p-0 flex flex-col gap-0 border-0 shadow-2xl rounded-xl overflow-hidden"
        style={{
          aspectRatio: '1536/1296',
          maxWidth: '90vw',
          maxHeight: '90vh',
          width: 'min(90vw, calc(90vh * 1536 / 1296))',
          height: 'min(90vh, calc(90vw * 1296 / 1536))'
        }}
      >
        <DialogHeader className="px-4 py-2 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-b border-slate-200/50 dark:border-slate-700/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Monitor className="w-4 h-4 text-slate-600 dark:text-slate-400" />
            <DialogTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Live View
            </DialogTitle>
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-green-500/10 dark:bg-green-400/10 rounded">
              <div className="w-1.5 h-1.5 bg-green-500 dark:bg-green-400 rounded-full animate-pulse" />
              <span className="text-[10px] font-medium text-green-600 dark:text-green-400">LIVE</span>
            </div>
          </div>
          <DialogDescription className="sr-only">
            Real-time view of the browser automation session
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex-1 w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 backdrop-blur-sm z-10">
              <div className="text-center">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
                  <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-blue-400 rounded-full animate-ping mx-auto opacity-20"></div>
                </div>
                <p className="text-slate-200 font-medium">Connecting to browser session...</p>
                <p className="text-slate-400 text-sm mt-1">Please wait</p>
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
                <p className="text-lg font-semibold text-red-400 mb-2">Connection Failed</p>
                <p className="text-sm text-slate-300 mb-4">{error}</p>
                <Button
                  variant="outline"
                  className="bg-slate-800 hover:bg-slate-700 text-white border-slate-600"
                  onClick={() => window.location.reload()}
                >
                  Reload Page
                </Button>
              </div>
            </div>
          )}

          <div
            id="dcv-display-container"
            ref={containerRef}
            style={{
              backgroundColor: '#000'
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
