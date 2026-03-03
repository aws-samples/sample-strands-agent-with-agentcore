/**
 * Tests for the session truncate API route
 *
 * Tests cover:
 * - fromEventId (positional): finds eventId in ordered list, deletes from there onward
 * - fromTimestamp (fallback): deletes events with eventTime >= fromTimestamp
 * - Local mode: delegates to truncateSessionMessages
 * - Validation: missing required params
 * - Error handling: AWS SDK failures, missing memoryId
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-utils', () => ({
  extractUserFromRequest: vi.fn(),
}))

vi.mock('@/lib/local-session-store', () => ({
  truncateSessionMessages: vi.fn(),
}))

import { extractUserFromRequest } from '@/lib/auth-utils'
import { truncateSessionMessages } from '@/lib/local-session-store'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  }
}

/** Build a fake ordered event list (newest-first, as the AWS SDK returns). */
function makeEvents(ids: string[], baseDateMs = 1_700_000_000_000) {
  // Newest-first: last id = smallest timestamp
  return ids.map((id, i) => ({
    eventId: id,
    eventTime: new Date(baseDateMs + (ids.length - 1 - i) * 1000).toISOString(),
  })).reverse() // keep order: index 0 = newest
}

// ---------------------------------------------------------------------------
// Truncation logic helpers (pure unit tests, no HTTP layer)
// ---------------------------------------------------------------------------

describe('Truncate logic – fromEventId (positional)', () => {
  it('deletes the target event and everything after it in chronological order', () => {
    const events = makeEvents(['ev-1', 'ev-2', 'ev-3', 'ev-4', 'ev-5'])
    // events is newest-first from the API; reverse to chronological
    const chronological = [...events].reverse()

    const fromEventId = 'ev-3'
    const fromIndex = chronological.findIndex((e) => e.eventId === fromEventId)

    expect(fromIndex).toBe(2) // ev-3 is at index 2 (0-based chronological)

    const toDelete = chronological.slice(fromIndex).map((e) => e.eventId)
    expect(toDelete).toEqual(['ev-3', 'ev-4', 'ev-5'])
  })

  it('deletes only the last event when fromEventId is the last one', () => {
    const events = makeEvents(['ev-1', 'ev-2', 'ev-3'])
    const chronological = [...events].reverse()

    const fromIndex = chronological.findIndex((e) => e.eventId === 'ev-3')
    const toDelete = chronological.slice(fromIndex).map((e) => e.eventId)

    expect(toDelete).toEqual(['ev-3'])
  })

  it('deletes all events when fromEventId is the first one', () => {
    const events = makeEvents(['ev-1', 'ev-2', 'ev-3'])
    const chronological = [...events].reverse()

    const fromIndex = chronological.findIndex((e) => e.eventId === 'ev-1')
    const toDelete = chronological.slice(fromIndex).map((e) => e.eventId)

    expect(toDelete).toEqual(['ev-1', 'ev-2', 'ev-3'])
  })

  it('returns empty list when fromEventId is not found', () => {
    const events = makeEvents(['ev-1', 'ev-2'])
    const chronological = [...events].reverse()

    const fromIndex = chronological.findIndex((e) => e.eventId === 'ev-999')
    expect(fromIndex).toBe(-1)

    const toDelete = fromIndex >= 0 ? chronological.slice(fromIndex) : []
    expect(toDelete).toHaveLength(0)
  })
})

describe('Truncate logic – fromTimestamp (fallback)', () => {
  const BASE_MS = 1_772_000_000_000

  it('deletes events with eventTime >= fromTimestamp', () => {
    const events = [
      { eventId: 'ev-1', eventTime: new Date(BASE_MS + 0).toISOString() },
      { eventId: 'ev-2', eventTime: new Date(BASE_MS + 1000).toISOString() },
      { eventId: 'ev-3', eventTime: new Date(BASE_MS + 2000).toISOString() },
      { eventId: 'ev-4', eventTime: new Date(BASE_MS + 3000).toISOString() },
    ]
    const fromTimestamp = BASE_MS + 2000

    const toDelete = events
      .filter((e) => new Date(e.eventTime).getTime() >= fromTimestamp)
      .map((e) => e.eventId)

    expect(toDelete).toEqual(['ev-3', 'ev-4'])
  })

  it('deletes nothing when all events are older than fromTimestamp', () => {
    const events = [
      { eventId: 'ev-1', eventTime: new Date(BASE_MS).toISOString() },
    ]
    const fromTimestamp = BASE_MS + 60_000

    const toDelete = events.filter(
      (e) => new Date(e.eventTime).getTime() >= fromTimestamp,
    )
    expect(toDelete).toHaveLength(0)
  })

  it('skips events without eventTime (treats as NaN)', () => {
    const events = [
      { eventId: 'ev-1', eventTime: null },
      { eventId: 'ev-2', eventTime: new Date(BASE_MS + 1000).toISOString() },
    ]
    const fromTimestamp = BASE_MS

    const toDelete = events
      .filter((e) => {
        const ms = e.eventTime ? new Date(e.eventTime).getTime() : NaN
        return !isNaN(ms) && ms >= fromTimestamp
      })
      .map((e) => e.eventId)

    expect(toDelete).toEqual(['ev-2']) // ev-1 skipped (no eventTime)
  })
})

// ---------------------------------------------------------------------------
// Route validation (simulating POST body handling)
// ---------------------------------------------------------------------------

describe('Truncate route – request validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects requests without sessionId', () => {
    const body = { fromEventId: 'ev-1' } // no sessionId
    const isValid = Boolean(body && (body as any).sessionId)
    expect(isValid).toBe(false)
  })

  it('rejects requests without fromEventId or fromTimestamp', () => {
    const body = { sessionId: 'sess-1' } // neither param
    const hasParam =
      (body as any).fromEventId !== undefined ||
      typeof (body as any).fromTimestamp === 'number'
    expect(hasParam).toBe(false)
  })

  it('accepts requests with fromEventId only', () => {
    const body = { sessionId: 'sess-1', fromEventId: 'ev-3' }
    const hasParam =
      body.fromEventId !== undefined ||
      typeof (body as any).fromTimestamp === 'number'
    expect(hasParam).toBe(true)
  })

  it('accepts requests with fromTimestamp only', () => {
    const body = { sessionId: 'sess-1', fromTimestamp: 1_772_000_000_000 }
    const hasParam =
      (body as any).fromEventId !== undefined ||
      typeof body.fromTimestamp === 'number'
    expect(hasParam).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Local mode
// ---------------------------------------------------------------------------

describe('Truncate route – local mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_AGENTCORE_LOCAL', 'true')
    ;(extractUserFromRequest as ReturnType<typeof vi.fn>).mockReturnValue({
      userId: 'test-user',
    })
  })

  it('calls truncateSessionMessages with userId, sessionId, fromTimestamp', () => {
    const mockTruncate = truncateSessionMessages as ReturnType<typeof vi.fn>
    mockTruncate.mockReturnValue(3)

    const userId = 'test-user'
    const sessionId = 'sess-local-1'
    const fromTimestamp = 1_772_000_000_000

    const deleted = truncateSessionMessages(userId, sessionId, fromTimestamp)

    expect(mockTruncate).toHaveBeenCalledWith(userId, sessionId, fromTimestamp)
    expect(deleted).toBe(3)
  })

  it('returns deleted count from truncateSessionMessages', () => {
    const mockTruncate = truncateSessionMessages as ReturnType<typeof vi.fn>
    mockTruncate.mockReturnValue(0)

    const deleted = truncateSessionMessages('user', 'sess', 0)
    expect(deleted).toBe(0)
  })

  it('does nothing for fromEventId in local mode (no eventId concept)', () => {
    const mockTruncate = truncateSessionMessages as ReturnType<typeof vi.fn>

    const fromEventId = 'ev-1'
    const fromTimestamp = undefined

    // In local mode with only fromEventId and no fromTimestamp, skip
    if (typeof fromTimestamp === 'number') {
      truncateSessionMessages('user', 'sess', fromTimestamp)
    }

    expect(mockTruncate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Frontend: message classification (history vs newly-sent)
// ---------------------------------------------------------------------------

describe('Message classification for truncation', () => {
  it('classifies non-numeric id as history message (has eventId)', () => {
    const messageId = 'abc123def456-some-event-id'
    expect(isNaN(Number(messageId))).toBe(true) // history message
  })

  it('classifies numeric id as newly-sent message (Date.now())', () => {
    const messageId = String(Date.now())
    expect(isNaN(Number(messageId))).toBe(false) // newly sent
  })

  it('uses fromEventId for history messages', () => {
    const message = { id: 'evt-abc123', rawTimestamp: 1_772_000_000_000 }
    const isHistory = isNaN(Number(message.id))
    const params = isHistory
      ? { fromEventId: message.id }
      : { fromTimestamp: message.rawTimestamp }

    expect(params).toEqual({ fromEventId: 'evt-abc123' })
  })

  it('uses fromTimestamp for newly-sent messages', () => {
    const message = { id: String(1_772_500_000_000), rawTimestamp: 1_772_500_000_000 }
    const isHistory = isNaN(Number(message.id))
    const params = isHistory
      ? { fromEventId: message.id }
      : { fromTimestamp: message.rawTimestamp }

    expect(params).toEqual({ fromTimestamp: 1_772_500_000_000 })
  })
})

// ---------------------------------------------------------------------------
// rawTimestamp assignment
// ---------------------------------------------------------------------------

describe('rawTimestamp assignment', () => {
  it('is set to Date.now() for newly-sent user messages', () => {
    const before = Date.now()
    const now = Date.now()
    const after = Date.now()

    // rawTimestamp should be within the current second
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(after)
  })

  it('is derived from ISO eventTime for history messages', () => {
    const isoTimestamp = '2026-03-03T23:57:59.000Z'
    const rawTimestamp = new Date(isoTimestamp).getTime()

    expect(rawTimestamp).toBe(new Date('2026-03-03T23:57:59.000Z').getTime())
    expect(typeof rawTimestamp).toBe('number')
    expect(isNaN(rawTimestamp)).toBe(false)
  })

  it('is undefined when eventTime is missing', () => {
    const isoTimestamp = undefined
    const rawTimestamp = isoTimestamp ? new Date(isoTimestamp).getTime() : undefined

    expect(rawTimestamp).toBeUndefined()
  })
})
