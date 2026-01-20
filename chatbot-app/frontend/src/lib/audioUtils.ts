/**
 * Audio Utilities for Voice Chat
 *
 * Handles:
 * - Microphone input capture (Web Audio API)
 * - PCM encoding/decoding
 * - Audio playback
 * - Sample rate conversion
 */

// Nova Sonic audio configuration
export const AUDIO_CONFIG = {
  sampleRate: 16000,      // 16kHz for Nova Sonic
  channels: 1,            // Mono
  bitDepth: 16,           // 16-bit PCM
  chunkDurationMs: 100,   // Send audio chunks every 100ms
} as const

export type AudioState = 'idle' | 'initializing' | 'recording' | 'error'

export interface AudioChunk {
  audio: string  // Base64 encoded PCM
  timestamp: number
}

/**
 * Encode Float32Array audio samples to Base64 PCM (16-bit)
 */
export function encodeAudioToBase64(samples: Float32Array): string {
  // Convert Float32 (-1 to 1) to Int16 (-32768 to 32767)
  const pcmData = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }

  // Convert to Base64
  const uint8Array = new Uint8Array(pcmData.buffer)
  let binary = ''
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i])
  }
  return btoa(binary)
}

/**
 * Decode Base64 PCM (16-bit) to Float32Array audio samples
 */
export function decodeBase64ToAudio(base64: string): Float32Array {
  // Decode Base64 to bytes
  const binary = atob(base64)
  const uint8Array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    uint8Array[i] = binary.charCodeAt(i)
  }

  // Convert Int16 to Float32
  const pcmData = new Int16Array(uint8Array.buffer)
  const samples = new Float32Array(pcmData.length)
  for (let i = 0; i < pcmData.length; i++) {
    samples[i] = pcmData[i] / (pcmData[i] < 0 ? 0x8000 : 0x7FFF)
  }

  return samples
}

/**
 * Resample audio from source sample rate to target sample rate
 * Simple linear interpolation - for production, consider using a proper resampler
 */
export function resampleAudio(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Float32Array {
  if (sourceSampleRate === targetSampleRate) {
    return samples
  }

  const ratio = sourceSampleRate / targetSampleRate
  const newLength = Math.round(samples.length / ratio)
  const resampled = new Float32Array(newLength)

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio
    const srcIndexFloor = Math.floor(srcIndex)
    const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1)
    const t = srcIndex - srcIndexFloor

    // Linear interpolation
    resampled[i] = samples[srcIndexFloor] * (1 - t) + samples[srcIndexCeil] * t
  }

  return resampled
}

/**
 * AudioRecorder class - captures microphone input and emits audio chunks
 */
export class AudioRecorder {
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private workletNode: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private onAudioChunk: ((chunk: AudioChunk) => void) | null = null
  private state: AudioState = 'idle'
  private audioBuffer: Float32Array[] = []
  private lastChunkTime: number = 0
  private workletBlobUrl: string | null = null

  constructor() {}

  getState(): AudioState {
    return this.state
  }

  private initPromise: Promise<void> | null = null

  /**
   * Initialize audio context and request microphone permission
   */
  async initialize(): Promise<void> {
    if (this.state === 'recording') {
      return
    }

    if (this.initPromise) {
      return this.initPromise
    }

    if (this.audioContext && this.mediaStream) {
      return
    }

    this.state = 'initializing'
    this.initPromise = this._doInitialize()
    return this.initPromise
  }

  private async _doInitialize(): Promise<void> {

    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: AUDIO_CONFIG.sampleRate },
          channelCount: { exact: AUDIO_CONFIG.channels },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      // Create audio context
      this.audioContext = new AudioContext({
        sampleRate: AUDIO_CONFIG.sampleRate,
      })

      // Load AudioWorklet processor
      await this.audioContext.audioWorklet.addModule(
        this.createWorkletProcessor()
      )

      this.state = 'idle'
    } catch (error) {
      console.error('[AudioRecorder] Initialization failed:', error)
      this.state = 'error'
      this.initPromise = null
      throw error
    }
  }

  /**
   * Create AudioWorklet processor as a Blob URL
   */
  private createWorkletProcessor(): string {
    // Revoke previous blob URL to prevent memory leak
    if (this.workletBlobUrl) {
      URL.revokeObjectURL(this.workletBlobUrl)
    }

    const processorCode = `
      class AudioChunkProcessor extends AudioWorkletProcessor {
        constructor() {
          super()
          this.bufferSize = ${Math.floor(AUDIO_CONFIG.sampleRate * AUDIO_CONFIG.chunkDurationMs / 1000)}
          this.buffer = new Float32Array(this.bufferSize)
          this.bufferIndex = 0
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0]
          if (input && input[0]) {
            const samples = input[0]

            for (let i = 0; i < samples.length; i++) {
              this.buffer[this.bufferIndex++] = samples[i]

              if (this.bufferIndex >= this.bufferSize) {
                // Send buffer to main thread
                this.port.postMessage({
                  type: 'audio',
                  samples: this.buffer.slice()
                })
                this.bufferIndex = 0
              }
            }
          }
          return true
        }
      }

      registerProcessor('audio-chunk-processor', AudioChunkProcessor)
    `

    const blob = new Blob([processorCode], { type: 'application/javascript' })
    this.workletBlobUrl = URL.createObjectURL(blob)
    return this.workletBlobUrl
  }

  /**
   * Start recording and emitting audio chunks
   */
  async start(onAudioChunk: (chunk: AudioChunk) => void): Promise<void> {
    if (this.state === 'recording') {
      return
    }

    if (!this.audioContext || !this.mediaStream) {
      await this.initialize()
    }

    if (!this.audioContext || !this.mediaStream) {
      throw new Error('Failed to initialize audio')
    }

    this.onAudioChunk = onAudioChunk
    this.lastChunkTime = Date.now()

    // Create source from media stream
    this.source = this.audioContext!.createMediaStreamSource(this.mediaStream!)

    // Create worklet node
    this.workletNode = new AudioWorkletNode(
      this.audioContext!,
      'audio-chunk-processor'
    )

    // Handle audio chunks from worklet
    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'audio' && this.onAudioChunk) {
        const samples = event.data.samples as Float32Array

        // Resample if needed (in case browser sample rate differs)
        const actualSampleRate = this.audioContext?.sampleRate || AUDIO_CONFIG.sampleRate
        const resampled = resampleAudio(samples, actualSampleRate, AUDIO_CONFIG.sampleRate)

        // Encode to base64
        const base64Audio = encodeAudioToBase64(resampled)

        this.onAudioChunk({
          audio: base64Audio,
          timestamp: Date.now(),
        })
      }
    }

    // Connect nodes
    this.source.connect(this.workletNode)
    // Don't connect to destination (we don't want to hear ourselves)

    this.state = 'recording'
  }

  /**
   * Stop recording
   */
  stop(): void {
    if (this.state !== 'recording') {
      return
    }

    if (this.workletNode) {
      this.workletNode.disconnect()
      this.workletNode = null
    }

    if (this.source) {
      this.source.disconnect()
      this.source = null
    }

    this.state = 'idle'
    this.onAudioChunk = null
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop()

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
    }

    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }

    // Revoke blob URL to prevent memory leak
    if (this.workletBlobUrl) {
      URL.revokeObjectURL(this.workletBlobUrl)
      this.workletBlobUrl = null
    }

    this.state = 'idle'
  }
}

/**
 * AudioPlayer class - plays audio chunks received from the server
 */
export class AudioPlayer {
  private audioContext: AudioContext | null = null
  private gainNode: GainNode | null = null
  private scheduledTime: number = 0
  private isPlaying: boolean = false
  // Track active audio sources for interruption handling
  private activeSources: Set<AudioBufferSourceNode> = new Set()

  constructor() {}

  /**
   * Initialize audio context for playback
   */
  async initialize(): Promise<void> {
    if (this.audioContext) {
      return
    }

    this.audioContext = new AudioContext({
      sampleRate: AUDIO_CONFIG.sampleRate,
    })

    this.gainNode = this.audioContext.createGain()
    this.gainNode.connect(this.audioContext.destination)
    this.gainNode.gain.value = 1.0

    this.scheduledTime = this.audioContext.currentTime
  }

  /**
   * Play audio chunk (base64 PCM)
   */
  async playChunk(base64Audio: string): Promise<void> {
    if (!this.audioContext || !this.gainNode) {
      await this.initialize()
    }

    // Resume context if suspended (browser autoplay policy)
    if (this.audioContext!.state === 'suspended') {
      await this.audioContext!.resume()
    }

    // Decode audio
    const samples = decodeBase64ToAudio(base64Audio)

    // Create audio buffer
    const buffer = this.audioContext!.createBuffer(
      AUDIO_CONFIG.channels,
      samples.length,
      AUDIO_CONFIG.sampleRate
    )
    buffer.getChannelData(0).set(samples)

    // Create buffer source
    const source = this.audioContext!.createBufferSource()
    source.buffer = buffer
    source.connect(this.gainNode!)

    // Track source for interruption handling
    this.activeSources.add(source)
    source.onended = () => {
      this.activeSources.delete(source)
    }

    // Schedule playback
    const now = this.audioContext!.currentTime
    const startTime = Math.max(now, this.scheduledTime)
    source.start(startTime)

    // Update scheduled time for next chunk
    this.scheduledTime = startTime + buffer.duration

    this.isPlaying = true
  }

  /**
   * Clear audio queue and stop playback (for interruptions)
   * This immediately stops all scheduled audio to allow user to speak
   */
  clear(): void {
    // Stop all currently scheduled/playing audio sources
    for (const source of this.activeSources) {
      try {
        source.stop()
        source.disconnect()
      } catch (e) {
        // Source may have already ended, ignore
      }
    }
    this.activeSources.clear()

    if (this.audioContext) {
      // Reset scheduled time to current time
      this.scheduledTime = this.audioContext.currentTime
    }
    this.isPlaying = false
  }

  /**
   * Set volume (0-1)
   */
  setVolume(volume: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, volume))
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.clear()

    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }

    this.gainNode = null
    this.activeSources.clear()
  }
}

/**
 * Check if browser supports required audio APIs
 * Returns false on server-side (SSR)
 */
export function checkAudioSupport(): {
  supported: boolean
  missing: string[]
} {
  // Server-side rendering check
  if (typeof window === 'undefined') {
    return {
      supported: false,
      missing: ['SSR - window not available'],
    }
  }

  const missing: string[] = []

  if (!navigator.mediaDevices?.getUserMedia) {
    missing.push('getUserMedia')
  }

  if (!window.AudioContext && !(window as any).webkitAudioContext) {
    missing.push('AudioContext')
  }

  if (!window.AudioWorkletNode) {
    missing.push('AudioWorklet')
  }

  return {
    supported: missing.length === 0,
    missing,
  }
}
