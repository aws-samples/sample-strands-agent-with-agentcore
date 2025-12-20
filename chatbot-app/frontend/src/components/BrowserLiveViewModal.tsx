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

        // Reduce DCV logging noise - only show errors
        dcv.setLogLevel(dcv.LogLevel.ERROR);

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
                    // Scale the display to fit the modal container
                    const display = document.getElementById('dcv-display-container');
                    if (display) {
                      // Get the viewport size directly
                      const viewportWidth = window.innerWidth;
                      const viewportHeight = window.innerHeight;

                      // Calculate modal size (95vw x 95vh)
                      const modalWidth = viewportWidth * 0.95;
                      const modalHeight = viewportHeight * 0.95;

                      // Subtract header height
                      const availableWidth = modalWidth;
                      const availableHeight = modalHeight - 60;

                      // Calculate scale to fit
                      const scaleX = availableWidth / serverWidth;
                      const scaleY = availableHeight / serverHeight;
                      const scale = Math.min(scaleX, scaleY, 1); // Don't scale up

                      // Apply scaling - center origin for better visual alignment
                      display.style.width = `${serverWidth}px`;
                      display.style.height = `${serverHeight}px`;
                      display.style.transform = `scale(${scale})`;
                      display.style.transformOrigin = 'center center';

                      const browserRatio = (serverWidth / serverHeight).toFixed(2);
                      const modalRatio = (availableWidth / availableHeight).toFixed(2);
                      console.log(`[DCV] Browser: ${serverWidth}x${serverHeight} (${browserRatio}:1), Modal: ${availableWidth.toFixed(0)}x${availableHeight.toFixed(0)} (${modalRatio}:1), Scale: ${scale.toFixed(3)} (scaleX: ${scaleX.toFixed(3)}, scaleY: ${scaleY.toFixed(3)})`);
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

        if (display) {
          // Get current browser resolution from display element
          const browserWidth = parseInt(display.style.width) || 1536;
          const browserHeight = parseInt(display.style.height) || 1296;

          // Get the viewport size directly
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;

          // Calculate modal size (95vw x 95vh)
          const modalWidth = viewportWidth * 0.95;
          const modalHeight = viewportHeight * 0.95;

          // Subtract header height
          const availableWidth = modalWidth;
          const availableHeight = modalHeight - 60;

          // Calculate scale to fit
          const scaleX = availableWidth / browserWidth;
          const scaleY = availableHeight / browserHeight;
          const scale = Math.min(scaleX, scaleY, 1);

          // Apply new scale
          display.style.transform = `scale(${scale})`;
          display.style.transformOrigin = 'center center';

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
      <DialogContent className="!max-w-none w-[95vw] h-[95vh] p-0 flex flex-col">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            <DialogTitle>Browser Live View</DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            Real-time view of the browser automation session
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex-1 w-full bg-gray-900 flex items-center justify-center overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-10">
              <div className="text-center text-white">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                <p>Connecting to browser session...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-10">
              <div className="text-center text-red-400 max-w-md">
                <p className="text-lg font-semibold mb-2">Connection Error</p>
                <p className="text-sm">{error}</p>
                <Button
                  variant="outline"
                  className="mt-4"
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
