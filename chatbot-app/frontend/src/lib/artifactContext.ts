import { Artifact } from '@/types/artifact'

interface ArtifactContextResult {
  additionalTools?: string[]
  artifactContext?: string
}

/**
 * Builds the artifact context string and additional tools to inject
 * into a chat message when the user has an artifact selected in Canvas.
 *
 * Add a new case here when introducing a new artifact type that
 * the agent should be aware of during chat.
 */
export function buildArtifactContext(artifact: Artifact | undefined): ArtifactContextResult {
  if (!artifact) return {}

  if (artifact.type === 'document') {
    const contentPreview = artifact.content.length > 1000
      ? artifact.content.substring(0, 1000) + '...'
      : artifact.content

    return {
      additionalTools: ['update_artifact'],
      artifactContext: `# ARTIFACT CONTEXT

The user currently has a document artifact open:
- **Title**: ${artifact.title}
- **Type**: ${artifact.type}
- **Current Content Preview**:
\`\`\`
${contentPreview}
\`\`\`

If the user asks to modify this document, use the update_artifact tool to find and replace specific text.`,
    }
  }

  if (artifact.type === 'excalidraw') {
    const elementsJson = JSON.stringify(artifact.content?.elements || [])

    return {
      artifactContext: `# ARTIFACT CONTEXT

The user currently has an Excalidraw diagram open:
- **Title**: ${artifact.title}
- **Current Elements** (JSON):
\`\`\`json
${elementsJson}
\`\`\`

If the user asks to modify this diagram, call create_excalidraw_diagram with the full updated elements array. Include all existing elements plus your changes — use the same element IDs when modifying existing elements, add new unique IDs for new elements, and omit elements you want to remove.`,
    }
  }

  return {}
}
