/**
 * src/lib/sse-client.ts
 *
 * SSE connection manager using XMLHttpRequest for React Native compatibility.
 *
 * React Native's fetch() does not expose response.body as a ReadableStream,
 * so we use XHR which provides incremental responseText via onreadystatechange
 * (readyState === 3 / LOADING).
 */

import type { SSEEventHandler } from './sse-parser';
import type { AGUIEvent } from '../types/events';
import { getIdToken } from './auth';
import { API_BASE_URL } from './constants';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SSEClientOptions {
  path: string;
  body: unknown;
  extraHeaders?: Record<string, string>;
  onEvent: SSEEventHandler;
  onComplete?: () => void;
  onError?: (err: Error) => void;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

export interface SSEClientHandle {
  abort(): void;
  readonly active: boolean;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export function connectSSEStream(opts: SSEClientOptions): SSEClientHandle {
  const {
    path,
    body,
    extraHeaders,
    onEvent,
    onComplete,
    onError,
    maxRetries = 3,
    retryBaseDelayMs = 1000,
  } = opts;

  let _active = true;
  let _xhr: XMLHttpRequest | null = null;
  let attemptsDone = 0;

  async function run(): Promise<void> {
    while (_active) {
      try {
        const token = await getIdToken();
        await openXHRStream(token);
        // Stream ended cleanly
        _active = false;
        onComplete?.();
        return;
      } catch (err: unknown) {
        if (!_active) {
          onComplete?.();
          return;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        attemptsDone++;

        if (attemptsDone > maxRetries) {
          _active = false;
          onError?.(error);
          return;
        }

        const delay = Math.min(
          retryBaseDelayMs * Math.pow(2, attemptsDone - 1),
          30_000,
        );
        console.warn(
          `[SSEClient] ${error.message} — retrying in ${delay} ms ` +
            `(${attemptsDone}/${maxRetries})`,
        );
        await sleep(delay);
      }
    }
  }

  function openXHRStream(token: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      _xhr = xhr;

      let processedLength = 0;
      let lineBuffer = '';

      xhr.open('POST', `${API_BASE_URL}${path}`);
      // Skip Content-Type for FormData — XHR sets the correct multipart boundary automatically
      if (!(body instanceof FormData)) {
        xhr.setRequestHeader('Content-Type', 'application/json');
      }
      xhr.setRequestHeader('Accept', 'text/event-stream');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) {
          xhr.setRequestHeader(k, v);
        }
      }

      xhr.onreadystatechange = () => {
        if (xhr.readyState === 3 || xhr.readyState === 4) {
          // Process new data since last check
          const newText = xhr.responseText.slice(processedLength);
          processedLength = xhr.responseText.length;

          if (newText) {
            lineBuffer += newText;
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trimEnd();
              if (!trimmed || trimmed.startsWith(':')) continue;
              if (trimmed.startsWith('data: ')) {
                const jsonStr = trimmed.slice(6);
                if (!jsonStr || jsonStr === '[DONE]') continue;
                try {
                  const event = JSON.parse(jsonStr) as AGUIEvent;
                  onEvent(event);
                } catch {
                  // skip malformed JSON
                }
              }
            }
          }
        }

        if (xhr.readyState === 4) {
          // Flush remaining buffer
          if (lineBuffer.trimEnd().startsWith('data: ')) {
            const jsonStr = lineBuffer.trimEnd().slice(6);
            if (jsonStr && jsonStr !== '[DONE]') {
              try {
                const event = JSON.parse(jsonStr) as AGUIEvent;
                onEvent(event);
              } catch {
                // ignore
              }
            }
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            attemptsDone = 0;
            resolve();
          } else if (xhr.status === 0) {
            // Aborted or network error — resolve silently if inactive
            resolve();
          } else {
            reject(
              new Error(`SSE ${path} → HTTP ${xhr.status}: ${xhr.statusText}`),
            );
          }
        }
      };

      xhr.onerror = () => {
        reject(new Error(`SSE ${path} → network error`));
      };

      xhr.send(body instanceof FormData ? body : JSON.stringify(body));
    });
  }

  void run();

  return {
    abort() {
      _active = false;
      _xhr?.abort();
      _xhr = null;
    },
    get active() {
      return _active;
    },
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
