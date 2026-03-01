import React from 'react'
import { Modal, Pressable, StyleSheet, Image, ScrollView, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

interface Props {
  uri: string | null
  onClose: () => void
}

export default function ImageLightbox({ uri, onClose }: Props) {
  if (!uri) return null
  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          maximumZoomScale={4}
          minimumZoomScale={1}
          bouncesZoom
          centerContent
        >
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        </ScrollView>
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <Ionicons name="close-circle" size={32} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    aspectRatio: 1,
  },
  closeBtn: {
    position: 'absolute',
    top: 52,
    right: 16,
  },
})
