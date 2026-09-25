export function normalizeDiagram(data: any, mod: any) {
  const elements = data.elements || []
  if (data.sceneVersion) return elements
  // Saved scenes use absolute text coordinates and existing bindings. The
  // skeleton converter treats centered text coordinates as anchors instead.
  const existingScene = elements.some((e: any) => e.containerId || typeof e.version === 'number')
  const converted = mod.convertToExcalidrawElements(elements, { regenerateIds: false })
  if (!existingScene) return converted
  const originals = new Map(elements.filter((e: any) => e.id && !e.label && !e.start && !e.end).map((e: any) => [e.id, e]))
  return mod.restoreElements(converted.map((e: any) => originals.get(e.id) || e), null, { repairBindings: true, refreshDimensions: true })
}
