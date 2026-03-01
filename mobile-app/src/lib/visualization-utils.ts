import type { MapData } from '../types/map'
import type { ChartData } from '../types/chart'

export interface VisualizationResult {
  mapData?: MapData
  chartData?: ChartData
}

/**
 * Extract the raw text from a tool result, handling:
 * - Plain JSON string: '{"success": true, ...}'
 * - Strands content array (from history): '[{"text": "..."}]' or stringified array
 */
function extractResultText(toolResult: string): string {
  try {
    const outer = JSON.parse(toolResult)

    // History format: content is array of blocks [{text: "..."}, ...]
    if (Array.isArray(outer)) {
      const texts: string[] = []
      for (const block of outer) {
        if (block.text) texts.push(block.text)
      }
      return texts.join('') || toolResult
    }

    // Already a plain object — return original string
    return toolResult
  } catch {
    return toolResult
  }
}

/**
 * Parse a tool result string and extract visualization data (map or chart).
 *
 * Mirrors the web frontend's ToolExecutionContainer unwrapping logic:
 *  1. Parse JSON
 *  2. If {statusCode, body} → unwrap Lambda response → body.content[].text
 *  3. If {result: "..."} → try inner parse
 *  4. Check for map_data / chart_data
 *
 * Also handles history format: [{text: "..."}]
 */
export function parseVisualizationResult(toolResult: string): VisualizationResult | null {
  try {
    const text = extractResultText(toolResult)
    let parsed = JSON.parse(text)

    // Unwrap Lambda response wrapper: {statusCode, body} → body.content[].text
    // (same logic as web frontend ToolExecutionContainer lines 203-214)
    if (parsed.statusCode && parsed.body) {
      try {
        const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body
        if (body.content && Array.isArray(body.content)) {
          const textContent = body.content.find((item: any) => item.type === 'text')
          if (textContent?.text) {
            parsed = JSON.parse(textContent.text)
          }
        } else if (body.map_data || body.chart_data) {
          parsed = body
        }
      } catch {
        // not a Lambda wrapped response
      }
    }

    // Unwrap MCP content array: {content: [{type: "text", text: "..."}]}
    if (parsed.content && Array.isArray(parsed.content) && !parsed.map_data && !parsed.chart_data) {
      try {
        const textContent = parsed.content.find((item: any) =>
          (typeof item === 'object' && item.text) || (item.type === 'text' && item.text)
        )
        if (textContent?.text) {
          const inner = JSON.parse(textContent.text)
          if (inner.map_data || inner.chart_data) {
            parsed = inner
          }
        }
      } catch {
        // not an MCP content wrapper
      }
    }

    // Unwrap {result: "..."} wrapper
    if (parsed.result && typeof parsed.result === 'string' && !parsed.map_data && !parsed.chart_data) {
      try {
        const inner = JSON.parse(parsed.result)
        if (inner.chart_data || inner.map_data) {
          parsed = inner
        }
      } catch {
        // not a wrapped response
      }
    }

    // Unwrap {body: "..."} string wrapper (skill_executor sometimes)
    if (parsed.body && typeof parsed.body === 'string' && !parsed.map_data && !parsed.chart_data) {
      try {
        const inner = JSON.parse(parsed.body)
        if (inner.map_data || inner.chart_data) {
          parsed = inner
        }
      } catch {
        // not a wrapped response
      }
    }

    const result: VisualizationResult = {}

    if (parsed.map_data && parsed.success !== false) {
      result.mapData = parsed.map_data
    }
    if (parsed.chart_data && parsed.success !== false) {
      result.chartData = parsed.chart_data
    }

    return result.mapData || result.chartData ? result : null
  } catch {
    return null
  }
}

/**
 * Generate a Google Maps URL that can be opened via Linking.openURL().
 */
export function generateMapsLink(mapData: MapData): string {
  const { type, center, markers, directions } = mapData

  if (type === 'directions' && directions) {
    const origin = directions.origin.address || `${directions.origin.lat},${directions.origin.lng}`
    const destination = directions.destination.address || `${directions.destination.lat},${directions.destination.lng}`
    const mode = directions.mode || 'driving'
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${mode}`
  }

  if (type === 'markers' && markers && markers.length > 0) {
    if (markers.length === 1) {
      const marker = markers[0]
      if (marker.place_id) {
        return `https://www.google.com/maps/place/?q=place_id:${marker.place_id}`
      }
      return `https://www.google.com/maps/search/?api=1&query=${marker.lat},${marker.lng}`
    }
    const query = markers.map(m => m.title || `${m.lat},${m.lng}`).join('|')
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  }

  return `https://www.google.com/maps/@${center.lat},${center.lng},${mapData.zoom}z`
}

/**
 * Generate a Google Maps URL for a single marker.
 */
export function generateMarkerLink(lat: number, lng: number, placeId?: string): string {
  if (placeId) {
    return `https://www.google.com/maps/place/?q=place_id:${placeId}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}
