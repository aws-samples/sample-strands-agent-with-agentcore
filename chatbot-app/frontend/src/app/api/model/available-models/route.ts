/**
 * Available Models endpoint - returns list of supported AI models
 */
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Available Bedrock models
const AVAILABLE_MODELS = [
  // Claude (Anthropic)
  {
    id: 'us.anthropic.claude-opus-4-6-v1',
    name: 'Claude Opus 4.6',
    provider: 'Anthropic',
    description: 'Most intelligent model, best for complex tasks'
  },
  {
    id: 'us.anthropic.claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    description: 'Most capable model, balanced performance'
  },
  {
    id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    description: 'Fast and efficient, cost-effective'
  },

  // DeepSeek
  {
    id: 'deepseek.v3.2',
    name: 'DeepSeek V3.2',
    provider: 'DeepSeek',
    description: 'Advanced language model with strong reasoning capabilities'
  },

  // Nova (Amazon)
  {
    id: 'us.amazon.nova-2-omni-v1:0',
    name: 'Nova 2 Omni',
    provider: 'Amazon',
    description: 'Preview multimodal model with advanced capabilities'
  },
  {
    id: 'us.amazon.nova-2-pro-preview-20251202-v1:0',
    name: 'Nova 2 Pro',
    provider: 'Amazon',
    description: 'High-performance multimodal model'
  },
  {
    id: 'us.amazon.nova-2-lite-v1:0',
    name: 'Nova 2 Lite',
    provider: 'Amazon',
    description: 'Lightweight and efficient model'
  },

  // GPT (OpenAI)
  {
    id: 'openai.gpt-oss-120b-1:0',
    name: 'GPT OSS 120B',
    provider: 'OpenAI',
    description: 'Open-source GPT model with 120B parameters'
  },
  {
    id: 'openai.gpt-oss-safeguard-20b',
    name: 'GPT OSS Safeguard 20B',
    provider: 'OpenAI',
    description: 'Content safety model for custom policy enforcement'
  },
  {
    id: 'openai.gpt-oss-safeguard-120b',
    name: 'GPT OSS Safeguard 120B',
    provider: 'OpenAI',
    description: 'Larger content safety model for complex moderation'
  },

  // Qwen
  {
    id: 'qwen.qwen3-vl-235b-a22b',
    name: 'Qwen3 VL 235B',
    provider: 'Qwen',
    description: 'Multimodal model for image, video, and code understanding'
  },
  {
    id: 'qwen.qwen3-235b-a22b-2507-v1:0',
    name: 'Qwen 235B',
    provider: 'Qwen',
    description: 'Large-scale language model with 235B parameters'
  },
  {
    id: 'qwen.qwen3-next-80b-a3b',
    name: 'Qwen3 Next 80B',
    provider: 'Qwen',
    description: 'Fast inference for ultra-long documents and RAG'
  },
  {
    id: 'qwen.qwen3-32b-v1:0',
    name: 'Qwen 32B',
    provider: 'Qwen',
    description: 'Efficient language model with 32B parameters'
  },

  // Gemma (Google)
  {
    id: 'google.gemma-3-27b-it',
    name: 'Gemma 3 27B',
    provider: 'Google',
    description: 'Powerful text and image model for enterprise'
  },
  {
    id: 'google.gemma-3-12b-it',
    name: 'Gemma 3 12B',
    provider: 'Google',
    description: 'Balanced text and image model for workstations'
  },
  {
    id: 'google.gemma-3-4b-it',
    name: 'Gemma 3 4B',
    provider: 'Google',
    description: 'Efficient text and image model for on-device AI'
  },

  // NVIDIA
  {
    id: 'nvidia.nemotron-nano-12b-v2',
    name: 'Nemotron Nano 12B v2 VL',
    provider: 'NVIDIA',
    description: 'Advanced multimodal reasoning for video understanding'
  },
  {
    id: 'nvidia.nemotron-nano-9b-v2',
    name: 'Nemotron Nano 9B v2',
    provider: 'NVIDIA',
    description: 'High efficiency for reasoning and agentic tasks'
  },

  // Mistral
  {
    id: 'mistral.voxtral-small-24b-2507',
    name: 'Voxtral Small 24B',
    provider: 'Mistral AI',
    description: 'State-of-the-art audio input with text performance'
  },
  {
    id: 'mistral.voxtral-mini-3b-2507',
    name: 'Voxtral Mini 3B',
    provider: 'Mistral AI',
    description: 'Advanced audio understanding with transcription'
  },

  // Others
  {
    id: 'moonshot.kimi-k2-thinking',
    name: 'Kimi K2 Thinking',
    provider: 'Moonshot AI',
    description: 'Deep reasoning model for complex workflows'
  },
  {
    id: 'minimax.minimax-m2',
    name: 'MiniMax M2',
    provider: 'MiniMax AI',
    description: 'Built for coding agents and automation'
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
