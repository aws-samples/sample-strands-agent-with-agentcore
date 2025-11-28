/**
 * Available Models endpoint - returns list of supported AI models
 */
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Available Bedrock models
const AVAILABLE_MODELS = [
  {
    id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    description: 'Fast and efficient, cost-effective'
  },
  {
    id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    description: 'Most capable model, balanced performance'
  },
  {
    id: 'qwen.qwen3-235b-a22b-2507-v1:0',
    name: 'Qwen 235B',
    provider: 'Qwen',
    description: 'Large-scale language model with 235B parameters'
  },
  {
    id: 'qwen.qwen3-32b-v1:0',
    name: 'Qwen 32B',
    provider: 'Qwen',
    description: 'Efficient language model with 32B parameters'
  },
  {
    id: 'openai.gpt-oss-120b-1:0',
    name: 'GPT OSS 120B',
    provider: 'OpenAI',
    description: 'Open-source GPT model with 120B parameters'
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
