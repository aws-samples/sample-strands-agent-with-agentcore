/**
 * Available Models endpoint - returns list of supported AI models
 */
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Available Bedrock models
const AVAILABLE_MODELS = [
  {
    id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    description: 'Most capable model, balanced performance'
  },
  {
    id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    description: 'Fast and efficient, cost-effective'
  },
  {
    id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    description: 'Previous generation, still very capable'
  },
  {
    id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    name: 'Claude 3.5 Haiku',
    provider: 'Anthropic',
    description: 'Previous generation, fast responses'
  }
]

export async function GET() {
  try {
    return NextResponse.json({
      models: AVAILABLE_MODELS
    })
  } catch (error) {
    console.error('[API] Error loading available models:', error)

    return NextResponse.json({
      models: AVAILABLE_MODELS
    })
  }
}
