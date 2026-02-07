/**
 * Available Models endpoint - returns list of supported AI models
 * Dynamically fetches models from AWS Bedrock API
 */
import { NextResponse } from 'next/server'
import {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
  type FoundationModelSummary,
  type InferenceProfileSummary
} from '@aws-sdk/client-bedrock'

export const runtime = 'nodejs'

// Initialize Bedrock client
const bedrockClient = new BedrockClient({})

// Cache for model modalities to avoid repeated API calls
const modalitiesCache = new Map<string, { inputModalities: string[]; outputModalities: string[] }>()

interface NormalizedModel {
  id: string
  name: string
  provider: string
  description: string
  modelType: 'foundation' | 'inference_profile'
  inputModalities: string[]
  outputModalities: string[]
}

/**
 * Get input and output modalities for a model from its ARN (with caching)
 */
function getModelModalities(
  modelArn: string
): { inputModalities: string[]; outputModalities: string[] } {
  // Extract model ID from ARN (last part after the final /)
  const modelId = modelArn.includes('/') ? modelArn.split('/').pop()! : modelArn

  // Check cache first
  if (modalitiesCache.has(modelId)) {
    return modalitiesCache.get(modelId)!
  }

  // Default to TEXT if not found in cache (will be populated from foundation models)
  return { inputModalities: ['TEXT'], outputModalities: ['TEXT'] }
}

/**
 * Fetch available foundation models from Bedrock
 */
async function listFoundationModels(): Promise<NormalizedModel[]> {
  const models: NormalizedModel[] = []

  try {
    const response = await bedrockClient.send(new ListFoundationModelsCommand({}))

    for (const model of response.modelSummaries ?? []) {
      // Only include models that support text output (for chat)
      const outputModalities = model.outputModalities ?? []
      if (!outputModalities.includes('TEXT')) {
        continue
      }

      const modelId = model.modelId ?? ''
      const inputModalities = model.inputModalities ?? []

      // Cache modalities for later use by inference profiles
      modalitiesCache.set(modelId, { inputModalities, outputModalities })

      models.push({
        id: modelId,
        name: model.modelName ?? '',
        provider: model.providerName ?? '',
        description: generateDescription(model),
        modelType: 'foundation',
        inputModalities,
        outputModalities
      })
    }

    console.log(`[API] Found ${models.length} foundation models, cached ${modalitiesCache.size} modalities`)
  } catch (error) {
    console.error('[API] Error listing foundation models:', error)
    throw error
  }

  return models
}

/**
 * Generate a description based on model capabilities
 */
function generateDescription(model: FoundationModelSummary): string {
  const inputModalities = model.inputModalities ?? []
  const outputModalities = model.outputModalities ?? []
  const capabilities: string[] = []

  // Check for multimodal capabilities
  if (inputModalities.includes('IMAGE')) {
    capabilities.push('image understanding')
  }
  if (outputModalities.includes('IMAGE')) {
    capabilities.push('image generation')
  }

  // Check for streaming support
  if (model.responseStreamingSupported) {
    capabilities.push('streaming')
  }

  if (capabilities.length > 0) {
    return `Supports ${capabilities.join(', ')}`
  }

  return 'Text generation model'
}

/**
 * Fetch available inference profiles from Bedrock
 */
async function listInferenceProfiles(): Promise<NormalizedModel[]> {
  const models: NormalizedModel[] = []

  try {
    let nextToken: string | undefined
    do {
      const response = await bedrockClient.send(
        new ListInferenceProfilesCommand({ nextToken })
      )

      for (const profile of response.inferenceProfileSummaries ?? []) {
        // Get the first model from the profile to check modalities
        const profileModels = profile.models ?? []
        if (profileModels.length === 0) {
          continue
        }

        const firstModel = profileModels[0]
        const modelArn = firstModel.modelArn ?? ''
        if (!modelArn) {
          continue
        }

        const { inputModalities, outputModalities } = getModelModalities(modelArn)

        // Only include profiles that support TEXT output (for chat)
        if (!outputModalities.includes('TEXT')) {
          continue
        }

        models.push({
          id: profile.inferenceProfileArn ?? profile.inferenceProfileId ?? '',
          name: profile.inferenceProfileName ?? '',
          provider: extractProviderFromProfile(profile),
          description: profile.description ?? 'Inference profile for optimized throughput',
          modelType: 'inference_profile',
          inputModalities,
          outputModalities
        })
      }

      nextToken = response.nextToken
    } while (nextToken)

    console.log(`[API] Found ${models.length} inference profiles`)
  } catch (error) {
    // ListInferenceProfiles may not be available in all regions or accounts
    console.warn('[API] Error listing inference profiles (may not be available):', error)
    return []
  }

  return models
}

/**
 * Extract provider name from inference profile
 */
function extractProviderFromProfile(profile: InferenceProfileSummary): string {
  const profileId = profile.inferenceProfileId ?? ''

  // Extract provider from profile ID (e.g., "us.anthropic.claude-..." -> "Anthropic")
  const parts = profileId.split('.')
  if (parts.length >= 2) {
    const providerPart = parts[1]
    // Capitalize first letter
    return providerPart.charAt(0).toUpperCase() + providerPart.slice(1)
  }

  return 'Unknown'
}

/**
 * Get the set of base model IDs that are covered by inference profiles
 */
function getInferenceProfileBaseModelIds(inferenceProfiles: NormalizedModel[]): Set<string> {
  const baseModelIds = new Set<string>()

  for (const profile of inferenceProfiles) {
    let profileId = profile.id

    // Handle ARN format
    if (profileId.includes('/')) {
      profileId = profileId.split('/').pop()!
    }

    // Remove region prefix (e.g., "us." or "eu.") to get base model ID
    const parts = profileId.split('.')
    if (parts.length >= 2 && parts[0].length <= 3) {
      // Looks like a region prefix (us, eu, ap, etc.)
      baseModelIds.add(parts.slice(1).join('.'))
    }
  }

  return baseModelIds
}

/**
 * Fetch all available models from both foundation models and inference profiles
 */
async function getAllModels(): Promise<NormalizedModel[]> {
  const allModels: NormalizedModel[] = []
  let foundationModels: NormalizedModel[] = []
  let inferenceProfiles: NormalizedModel[] = []

  // Fetch foundation models first to populate the modalities cache
  try {
    foundationModels = await listFoundationModels()
  } catch (error) {
    console.error('[API] Failed to list foundation models:', error)
  }

  // Then fetch inference profiles (uses cached modalities from foundation models)
  try {
    inferenceProfiles = await listInferenceProfiles()
  } catch (error) {
    console.warn('[API] Failed to list inference profiles:', error)
  }

  // Get the base model IDs covered by inference profiles
  const profileBaseIds = getInferenceProfileBaseModelIds(inferenceProfiles)
  console.log(`[API] Inference profiles cover ${profileBaseIds.size} base models`)

  // Filter out foundation models that have a corresponding inference profile
  // (those models require invocation via the profile, not directly)
  let filteredCount = 0
  for (const model of foundationModels) {
    if (!profileBaseIds.has(model.id)) {
      allModels.push(model)
    } else {
      filteredCount++
      console.log(`[API] Filtering out foundation model ${model.id} (use inference profile instead)`)
    }
  }

  if (filteredCount > 0) {
    console.log(`[API] Filtered out ${filteredCount} foundation models (require inference profiles)`)
  }

  // Add all inference profiles
  allModels.push(...inferenceProfiles)

  // Sort by provider name, then model name
  allModels.sort((a, b) => {
    const providerCompare = a.provider.localeCompare(b.provider)
    if (providerCompare !== 0) return providerCompare
    return a.name.localeCompare(b.name)
  })

  console.log(`[API] Total models available: ${allModels.length}`)
  return allModels
}

export async function GET() {
  try {
    const models = await getAllModels()

    // Transform to the expected frontend format
    const formattedModels = models.map(model => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      description: model.description
    }))

    return NextResponse.json({
      models: formattedModels
    })
  } catch (error) {
    console.error('[API] Error loading available models:', error)

    // Return empty list on error
    return NextResponse.json(
      { error: 'Failed to fetch available models', models: [] },
      { status: 500 }
    )
  }
}
