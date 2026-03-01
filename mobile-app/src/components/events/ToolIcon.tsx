import React from 'react'
import { Image, type ImageSourcePropType } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { IconEntry } from '../../config/tool-icons'

interface Props {
  entry: IconEntry | null
  size?: number
  color?: string // used for Ionicons fallback tint
}

export default function ToolIcon({ entry, size = 16, color }: Props) {
  if (!entry) {
    // Fallback: generic construct icon
    return <Ionicons name="construct-outline" size={size} color={color ?? '#888'} />
  }

  if (entry.kind === 'svg') {
    const SvgComp = entry.Component
    return <SvgComp width={size} height={size} />
  }

  // PNG
  return (
    <Image
      source={entry.source as ImageSourcePropType}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  )
}
