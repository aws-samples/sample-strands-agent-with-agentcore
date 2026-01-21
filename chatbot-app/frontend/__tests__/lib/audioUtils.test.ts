/**
 * Tests for audioUtils.ts
 *
 * Tests the pure utility functions for audio encoding/decoding.
 * These are critical for voice chat functionality - incorrect encoding
 * would result in corrupted audio that's hard to debug.
 */
import { describe, it, expect } from 'vitest'
import {
  encodeAudioToBase64,
  decodeBase64ToAudio,
  resampleAudio,
  AUDIO_CONFIG,
} from '@/lib/audioUtils'

describe('Audio Encoding/Decoding', () => {
  describe('encodeAudioToBase64', () => {
    it('encodes silence (zeros) correctly', () => {
      const silence = new Float32Array([0, 0, 0, 0])
      const encoded = encodeAudioToBase64(silence)

      // Decode and verify roundtrip
      const decoded = decodeBase64ToAudio(encoded)
      expect(decoded.length).toBe(4)
      decoded.forEach(sample => {
        expect(sample).toBeCloseTo(0, 5)
      })
    })

    it('encodes max positive value correctly', () => {
      const maxPositive = new Float32Array([1.0, 1.0])
      const encoded = encodeAudioToBase64(maxPositive)
      const decoded = decodeBase64ToAudio(encoded)

      // Should be close to 1.0 (slight precision loss is acceptable)
      decoded.forEach(sample => {
        expect(sample).toBeGreaterThan(0.99)
        expect(sample).toBeLessThanOrEqual(1.0)
      })
    })

    it('encodes max negative value correctly', () => {
      const maxNegative = new Float32Array([-1.0, -1.0])
      const encoded = encodeAudioToBase64(maxNegative)
      const decoded = decodeBase64ToAudio(encoded)

      decoded.forEach(sample => {
        expect(sample).toBeLessThan(-0.99)
        expect(sample).toBeGreaterThanOrEqual(-1.0)
      })
    })

    it('clamps values outside [-1, 1] range', () => {
      const outOfRange = new Float32Array([2.0, -2.0, 1.5, -1.5])
      const encoded = encodeAudioToBase64(outOfRange)
      const decoded = decodeBase64ToAudio(encoded)

      // Values should be clamped to [-1, 1]
      decoded.forEach(sample => {
        expect(sample).toBeGreaterThanOrEqual(-1.0)
        expect(sample).toBeLessThanOrEqual(1.0)
      })
    })

    it('preserves waveform shape through encode/decode cycle', () => {
      // Simple sine wave approximation
      const samples = new Float32Array([0, 0.5, 1.0, 0.5, 0, -0.5, -1.0, -0.5])
      const encoded = encodeAudioToBase64(samples)
      const decoded = decodeBase64ToAudio(encoded)

      expect(decoded.length).toBe(samples.length)
      for (let i = 0; i < samples.length; i++) {
        // Allow small precision loss from 16-bit quantization
        expect(decoded[i]).toBeCloseTo(samples[i], 3)
      }
    })
  })

  describe('decodeBase64ToAudio', () => {
    it('produces Float32Array output', () => {
      const silence = new Float32Array([0, 0])
      const encoded = encodeAudioToBase64(silence)
      const decoded = decodeBase64ToAudio(encoded)

      expect(decoded).toBeInstanceOf(Float32Array)
    })

    it('handles empty audio', () => {
      const empty = new Float32Array([])
      const encoded = encodeAudioToBase64(empty)
      const decoded = decodeBase64ToAudio(encoded)

      expect(decoded.length).toBe(0)
    })
  })

  describe('resampleAudio', () => {
    it('returns same array when sample rates match', () => {
      const samples = new Float32Array([0.1, 0.2, 0.3, 0.4])
      const result = resampleAudio(samples, 16000, 16000)

      expect(result.length).toBe(samples.length)
      for (let i = 0; i < samples.length; i++) {
        expect(result[i]).toBe(samples[i])
      }
    })

    it('downsamples correctly (48kHz to 16kHz)', () => {
      // 48kHz has 3x samples of 16kHz
      const samples48k = new Float32Array(48)
      for (let i = 0; i < 48; i++) {
        samples48k[i] = i / 48  // Linear ramp
      }

      const result = resampleAudio(samples48k, 48000, 16000)

      // Should have approximately 1/3 the samples
      expect(result.length).toBe(16)
    })

    it('upsamples correctly (8kHz to 16kHz)', () => {
      const samples8k = new Float32Array([0, 0.5, 1.0, 0.5])
      const result = resampleAudio(samples8k, 8000, 16000)

      // Should have 2x the samples
      expect(result.length).toBe(8)
    })

    it('preserves approximate amplitude after resampling', () => {
      // Constant signal should remain constant
      const constant = new Float32Array(100).fill(0.7)
      const resampled = resampleAudio(constant, 48000, 16000)

      resampled.forEach(sample => {
        expect(sample).toBeCloseTo(0.7, 2)
      })
    })
  })

  describe('AUDIO_CONFIG', () => {
    it('has correct Nova Sonic configuration', () => {
      expect(AUDIO_CONFIG.sampleRate).toBe(16000)
      expect(AUDIO_CONFIG.channels).toBe(1)
      expect(AUDIO_CONFIG.bitDepth).toBe(16)
    })
  })
})
