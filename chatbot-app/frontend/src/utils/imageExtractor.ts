/**
 * Image extraction utilities for AgentCore Memory blob handling
 */

export interface ImageData {
  format: string
  data: string
}

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
 * Handles multiple image formats from Strands SDK
 */
export function extractToolResultImages(toolResult: any): ImageData[] {
  const images: ImageData[] = []

  if (!toolResult?.content || !Array.isArray(toolResult.content)) {
    return images
  }

  toolResult.content.forEach((c: any) => {
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
  })

  return images
}

/**
 * Extract text content from toolResult
 */
export function extractToolResultText(toolResult: any): string {
  let text = ''

  if (!toolResult?.content || !Array.isArray(toolResult.content)) {
    return text
  }

  toolResult.content.forEach((c: any) => {
    if (c.text) {
      text += c.text
    } else if (!c.image) {
      // Other content types - stringify as fallback
      text += JSON.stringify(c)
    }
  })

  return text
}
