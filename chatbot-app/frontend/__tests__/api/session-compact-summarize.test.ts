import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  sign: vi.fn(async (request: any) => ({ ...request, headers: { ...request.headers, authorization: 'test-signature' } })),
  signerOptions: {} as Record<string, unknown>,
}))
vi.mock('@smithy/signature-v4', () => ({
  SignatureV4: class {
    constructor(options: any) { mocks.signerOptions = options }
    sign = mocks.sign
  },
}))
vi.mock('@aws-sdk/credential-providers', () => ({ fromNodeProviderChain: () => vi.fn() }))
import { POST } from '@/app/api/session/compact/summarize/route'

function request() {
  return new NextRequest('http://localhost/api/session/compact/summarize', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Release Aurora on Friday.' }] }),
  })
}

describe('Mantle conversation summary', () => {
  beforeEach(() => { vi.unstubAllGlobals(); mocks.sign.mockClear() })

  it('signs for us-east-1 and preserves the plain-text response contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: 'Aurora ships Friday.' }] },
    ] }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(await response.text()).toBe('Aurora ships Friday.')
    expect(mocks.signerOptions).toMatchObject({ service: 'bedrock', region: 'us-east-1' })
    const [url, options] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://bedrock-mantle.us-east-1.api.aws/openai/v1/responses')
    expect(JSON.parse(options.body)).toMatchObject({ model: 'openai.gpt-6-luna', max_output_tokens: 4096 })
    expect(options.headers.authorization).toBe('test-signature')
  })

  it('reports an upstream failure without returning an empty successful summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('access denied', { status: 403 })))
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ success: false, message: expect.stringContaining('(403)') })
  })
})
