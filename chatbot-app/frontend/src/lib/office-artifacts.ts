import type { Artifact } from '@/types/artifact'

/** Match the IDs persisted by the Office tools, including legacy UI entries. */
export function officeArtifactId(type: string, filename: string): string | null {
  const formats: Record<string, [string, string]> = {
    word_document: ['word', '.docx'],
    excel_spreadsheet: ['excel', '.xlsx'],
    powerpoint_presentation: ['ppt', '.pptx'],
  }
  const format = formats[type]
  return format ? `${format[0]}-${filename.split(format[1]).join('')}` : null
}

export function normalizeOfficeArtifact(artifact: Artifact): Artifact {
  const id = officeArtifactId(artifact.type, artifact.metadata?.filename || artifact.title)
  return id ? { ...artifact, id } : artifact
}

export function deduplicateArtifacts(artifacts: Artifact[]): Artifact[] {
  const byId = new Map<string, Artifact>()
  for (const item of artifacts) {
    const artifact = normalizeOfficeArtifact(item)
    byId.set(artifact.id, { ...byId.get(artifact.id), ...artifact })
  }
  return [...byId.values()]
}
