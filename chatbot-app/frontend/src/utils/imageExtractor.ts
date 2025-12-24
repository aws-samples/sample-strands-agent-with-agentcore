/**
 * Image extraction utilities for AgentCore Memory blob handling
 */

export type ImageData =
  | { format: string; data: string }
  | { type: 'url'; url: string; thumbnail?: string; title?: string; width?: number; height?: number }

/**
 * Extract blob images from message, matched by toolUseId
 * Handles both new _blobImages (multiple) and legacy _blobImage (single)
 */
export function extractBlobImages(msg: any, toolUseId: string): ImageData[] {
  const images: ImageData[] = []

  // Priority: check _blobImages with toolUseId first
  if (msg._blobImages && msg._blobImages[toolUseId]) {
    const blobImage = msg._blobImages[toolUseId]
    images.push({
      format: blobImage.format,
      data: blobImage.data
    })
  } else if (msg._blobImage && msg._blobImage.format && msg._blobImage.data) {
    // Backward compatibility: single blob image per message
    images.push({
      format: msg._blobImage.format,
      data: msg._blobImage.data
    })
  }

  return images
}

/**
 * Extract images from toolResult content array
 * Handles multiple image formats from Strands SDK and Lambda wrapper unwrapping
 */
export function extractToolResultImages(toolResult: any): ImageData[] {
  const images: ImageData[] = []

  if (!toolResult?.content || !Array.isArray(toolResult.content)) {
    return images
  }

  // Unwrap Lambda response if present (Gateway tools)
  // Lambda format: content[0].text = "{\"statusCode\":200,\"body\":\"...\"}"
  let content = toolResult.content
  if (content.length > 0 && content[0].text) {
    try {
      const text = content[0].text
      const parsed = JSON.parse(text)

      // Check if this is a Lambda wrapper
      if (parsed.statusCode && parsed.body) {
        const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body

        // If unwrapped body has content array, use it
        if (body.content && Array.isArray(body.content)) {
          content = body.content
        }
      }
    } catch (e) {
      // Not JSON or parsing failed, use original content
    }
  }

  content.forEach((c: any) => {
    // Handle image ContentBlock
    if (c.image) {
      let imageData = ''

      if (c.image.source?.data) {
        // Already base64 string
        imageData = c.image.source.data
      } else if (c.image.source?.bytes) {
        // Handle different bytes formats
        const bytes = c.image.source.bytes

        if (typeof bytes === 'string') {
          // Already base64
          imageData = bytes
        } else if (bytes.__bytes_encoded__ && bytes.data) {
          // Strands SDK special format: {__bytes_encoded__: true, data: "base64..."}
          imageData = bytes.data
        } else if (Array.isArray(bytes) || bytes instanceof Uint8Array) {
          // Array of bytes - convert to base64
          imageData = btoa(String.fromCharCode(...new Uint8Array(bytes)))
        }
      }

      if (imageData) {
        images.push({
          format: c.image.format || 'png',
          data: imageData
        })
      }
    }
    // Handle Google search images in text JSON (URL-based images)
    else if (c.text && c.text.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(c.text)

        // Google search format: {query: "...", results: [...], images: [{link, thumbnail, ...}]}
        if (parsed.images && Array.isArray(parsed.images)) {
          parsed.images.forEach((img: any) => {
            if (img.link) {
              images.push({
                type: 'url' as const,
                url: img.link,
                thumbnail: img.thumbnail,
                title: img.title,
                width: img.width,
                height: img.height
              })
            }
          })
        }
      } catch (e) {
        // Not JSON or no images field
      }
    }
  })

  return images
}

/**
 * Extract text content from toolResult with Lambda wrapper unwrapping
 */
export function extractToolResultText(toolResult: any): string {
  let text = ''

  if (!toolResult?.content || !Array.isArray(toolResult.content)) {
    return text
  }

  // Unwrap Lambda response if present (Gateway tools)
  // Lambda format: content[0].text = "{\"statusCode\":200,\"body\":\"...\"}"
  let content = toolResult.content
  if (content.length > 0 && content[0].text) {
    try {
      const textContent = content[0].text
      const parsed = JSON.parse(textContent)

      // Check if this is a Lambda wrapper
      if (parsed.statusCode && parsed.body) {
        const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body

        // If unwrapped body has content array, use it
        if (body.content && Array.isArray(body.content)) {
          content = body.content
        }
      }
    } catch (e) {
      // Not JSON or parsing failed, use original content
    }
  }

  content.forEach((c: any) => {
    if (c.text) {
      text += c.text
    } else if (!c.image) {
      // Other content types - stringify as fallback
      text += JSON.stringify(c)
    }
  })

  return text
}
