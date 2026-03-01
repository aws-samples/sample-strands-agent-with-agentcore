import React from 'react'
import { ScrollView, Image, StyleSheet, Dimensions } from 'react-native'

interface Props {
  content: string
}

const { width: SCREEN_WIDTH } = Dimensions.get('window')

export default function ImageViewer({ content }: Props) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      maximumZoomScale={3}
      minimumZoomScale={1}
      bouncesZoom
      centerContent
    >
      <Image
        source={{ uri: content }}
        style={styles.image}
        resizeMode="contain"
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH,
  },
})
