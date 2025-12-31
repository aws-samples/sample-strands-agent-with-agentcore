import { describe, it, expect } from 'vitest'
import {
  extractBlobImages,
  extractToolResultImages,
  extractToolResultText,
  ImageData
} from '@/utils/imageExtractor'

describe('imageExtractor', () => {
  describe('extractBlobImages', () => {
    it('should return empty array for message without blob images', () => {
      const msg = { id: '123', content: 'Hello' }
      const result = extractBlobImages(msg, 'tool-1')
      expect(result).toEqual([])
    })

    it('should extract image from _blobImages by toolUseId', () => {
      const msg = {
        _blobImages: {
          'tool-1': { format: 'png', data: 'base64data1' },
          'tool-2': { format: 'jpeg', data: 'base64data2' }
        }
      }

      const result = extractBlobImages(msg, 'tool-1')
      expect(result).toEqual([{ format: 'png', data: 'base64data1' }])
    })

    it('should return empty array when toolUseId not found in _blobImages', () => {
      const msg = {
        _blobImages: {
          'tool-1': { format: 'png', data: 'base64data1' }
        }
      }

      const result = extractBlobImages(msg, 'tool-999')
      expect(result).toEqual([])
    })

    it('should fallback to legacy _blobImage format', () => {
      const msg = {
        _blobImage: { format: 'gif', data: 'legacybase64' }
      }

      const result = extractBlobImages(msg, 'any-tool-id')
      expect(result).toEqual([{ format: 'gif', data: 'legacybase64' }])
    })

    it('should prioritize _blobImages over legacy _blobImage', () => {
      const msg = {
        _blobImages: {
          'tool-1': { format: 'png', data: 'newformat' }
        },
        _blobImage: { format: 'gif', data: 'legacyformat' }
      }

      const result = extractBlobImages(msg, 'tool-1')
      expect(result).toEqual([{ format: 'png', data: 'newformat' }])
    })

    it('should handle incomplete _blobImage (missing format/data)', () => {
      const msg = {
        _blobImage: { format: 'png' } // missing data
      }

      const result = extractBlobImages(msg, 'any-tool-id')
      expect(result).toEqual([])
    })
  })

  describe('extractToolResultImages', () => {
    it('should return empty array for null/undefined toolResult', () => {
      expect(extractToolResultImages(null)).toEqual([])
      expect(extractToolResultImages(undefined)).toEqual([])
    })

    it('should return empty array for toolResult without content array', () => {
      expect(extractToolResultImages({})).toEqual([])
      expect(extractToolResultImages({ content: 'not an array' })).toEqual([])
    })

    it('should extract image from image ContentBlock with source.data', () => {
      const toolResult = {
        content: [
          {
            image: {
              format: 'png',
              source: { data: 'base64imagedata' }
            }
          }
        ]
      }

      const result = extractToolResultImages(toolResult)
      expect(result).toEqual([{ format: 'png', data: 'base64imagedata' }])
    })

    it('should extract image from image ContentBlock with source.bytes (string)', () => {
      const toolResult = {
        content: [
          {
            image: {
              format: 'jpeg',
              source: { bytes: 'base64string' }
            }
          }
        ]
      }

      const result = extractToolResultImages(toolResult)
      expect(result).toEqual([{ format: 'jpeg', data: 'base64string' }])
    })

    it('should handle Strands SDK special format (__bytes_encoded__)', () => {
      const toolResult = {
        content: [
          {
            image: {
              format: 'png',
              source: {
                bytes: {
                  __bytes_encoded__: true,
                  data: 'strandsbase64'
                }
              }
            }
          }
        ]
      }

      const result = extractToolResultImages(toolResult)
      expect(result).toEqual([{ format: 'png', data: 'strandsbase64' }])
    })

    it('should convert byte array to base64', () => {
      // 'Hi' in bytes
      const toolResult = {
        content: [
          {
            image: {
              format: 'png',
              source: { bytes: [72, 105] } // 'Hi'
            }
          }
        ]
      }

      const result = extractToolResultImages(toolResult)
      expect(result).toHaveLength(1)
      const img = result[0] as { format: string; data: string }
      expect(img.format).toBe('png')
      expect(img.data).toBe('SGk=') // base64 of 'Hi'
    })

    it('should default to png format when format is missing', () => {
      const toolResult = {
        content: [
          {
            image: {
              source: { data: 'somedata' }
            }
          }
        ]
      }

      const result = extractToolResultImages(toolResult)
      expect(result).toEqual([{ format: 'png', data: 'somedata' }])
    })

    it('should extract URL-based images from Google search results', () => {
      const toolResult = {
        content: [
          {
            text: JSON.stringify({
              query: 'cats',
              results: [],
              images: [
                { link: 'https://example.com/cat1.jpg', thumbnail: 'https://example.com/thumb1.jpg', title: 'Cat 1' },
                { link: 'https://example.com/cat2.jpg', width: 800, height: 600 }
              ]
            })
          }
        ]
      }

      const result = extractToolResultImages(toolResult)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        type: 'url',
        url: 'https://example.com/cat1.jpg',
        thumbnail: 'https://example.com/thumb1.jpg',
        title: 'Cat 1',
        width: undefined,
        height: undefined
      })
      expect(result[1]).toEqual({
        type: 'url',
        url: 'https://example.com/cat2.jpg',
        thumbnail: undefined,
        title: undefined,
        width: 800,
        height: 600
      })
    })

    it('should skip images without link in Google search results', () => {
      const toolResult = {
        content: [
          {
            text: JSON.stringify({
              images: [
                { thumbnail: 'https://example.com/thumb.jpg' }, // no link
                { link: 'https://example.com/valid.jpg' }
              ]
            })
          }
        ]
      }

      const result = extractToolResultImages(toolResult)
      expect(result).toHaveLength(1)
      expect((result[0] as any).url).toBe('https://example.com/valid.jpg')
    })

    it('should unwrap Lambda response and extract images', () => {
      const innerContent = [
        {
          image: {
            format: 'png',
            source: { data: 'lambdaimage' }
          }
        }
      ]

      const toolResult = {
        content: [
          {
            text: JSON.stringify({
              statusCode: 200,
              body: JSON.stringify({ content: innerContent })
            })
          }
        ]
      }

      const result = extractToolResultImages(toolResult)
      expect(result).toEqual([{ format: 'png', data: 'lambdaimage' }])
    })

    it('should handle Lambda response with pre-parsed body', () => {
      const toolResult = {
        content: [
          {
            text: JSON.stringify({
              statusCode: 200,
              body: {
                content: [
                  { image: { format: 'jpeg', source: { data: 'preparsed' } } }
                ]
              }
            })
          }
        ]
      }

      const result = extractToolResultImages(toolResult)
      expect(result).toEqual([{ format: 'jpeg', data: 'preparsed' }])
    })

    it('should handle multiple images in content array', () => {
      const toolResult = {
        content: [
          { image: { format: 'png', source: { data: 'img1' } } },
          { text: 'some text' },
          { image: { format: 'jpeg', source: { data: 'img2' } } }
        ]
      }

      const result = extractToolResultImages(toolResult)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ format: 'png', data: 'img1' })
      expect(result[1]).toEqual({ format: 'jpeg', data: 'img2' })
    })

    it('should gracefully handle invalid JSON in text field', () => {
      const toolResult = {
        content: [
          { text: '{invalid json' }
        ]
      }

      // Should not throw, just return empty
      const result = extractToolResultImages(toolResult)
      expect(result).toEqual([])
    })

    it('should handle text that does not start with {', () => {
      const toolResult = {
        content: [
          { text: 'Regular text message' }
        ]
      }

      const result = extractToolResultImages(toolResult)
      expect(result).toEqual([])
    })
  })

  describe('extractToolResultText', () => {
    it('should return empty string for null/undefined toolResult', () => {
      expect(extractToolResultText(null)).toBe('')
      expect(extractToolResultText(undefined)).toBe('')
    })

    it('should return empty string for toolResult without content array', () => {
      expect(extractToolResultText({})).toBe('')
      expect(extractToolResultText({ content: 'not array' })).toBe('')
    })

    it('should extract text from text content blocks', () => {
      const toolResult = {
        content: [
          { text: 'Hello ' },
          { text: 'World' }
        ]
      }

      const result = extractToolResultText(toolResult)
      expect(result).toBe('Hello World')
    })

    it('should skip image blocks', () => {
      const toolResult = {
        content: [
          { text: 'Text before ' },
          { image: { format: 'png', source: { data: 'xxx' } } },
          { text: 'Text after' }
        ]
      }

      const result = extractToolResultText(toolResult)
      expect(result).toBe('Text before Text after')
    })

    it('should stringify other content types', () => {
      const toolResult = {
        content: [
          { text: 'Text ' },
          { customField: 'value' }
        ]
      }

      const result = extractToolResultText(toolResult)
      expect(result).toBe('Text {"customField":"value"}')
    })

    it('should unwrap Lambda response and extract text', () => {
      const toolResult = {
        content: [
          {
            text: JSON.stringify({
              statusCode: 200,
              body: JSON.stringify({
                content: [
                  { text: 'Lambda unwrapped text' }
                ]
              })
            })
          }
        ]
      }

      const result = extractToolResultText(toolResult)
      expect(result).toBe('Lambda unwrapped text')
    })

    it('should handle Lambda response with pre-parsed body', () => {
      const toolResult = {
        content: [
          {
            text: JSON.stringify({
              statusCode: 200,
              body: {
                content: [
                  { text: 'Pre-parsed body text' }
                ]
              }
            })
          }
        ]
      }

      const result = extractToolResultText(toolResult)
      expect(result).toBe('Pre-parsed body text')
    })

    it('should handle non-Lambda JSON text gracefully', () => {
      const toolResult = {
        content: [
          { text: JSON.stringify({ someKey: 'someValue' }) }
        ]
      }

      // Since it's not a Lambda wrapper (no statusCode+body), treat as regular text
      const result = extractToolResultText(toolResult)
      expect(result).toBe('{"someKey":"someValue"}')
    })

    it('should handle mixed content after Lambda unwrapping', () => {
      const toolResult = {
        content: [
          {
            text: JSON.stringify({
              statusCode: 200,
              body: JSON.stringify({
                content: [
                  { text: 'Part 1 ' },
                  { image: { format: 'png', source: { data: 'xxx' } } },
                  { text: 'Part 2' }
                ]
              })
            })
          }
        ]
      }

      const result = extractToolResultText(toolResult)
      expect(result).toBe('Part 1 Part 2')
    })
  })
})
