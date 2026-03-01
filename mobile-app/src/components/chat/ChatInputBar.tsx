import React, { useCallback, useRef, useState } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import type { ImagePickerAsset } from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { useTheme } from '../../context/ThemeContext'
import type { PickedDocument } from '../../types/chat'

const SUPPORTED_DOC_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]

interface Props {
  onSend: (text: string, images?: ImagePickerAsset[], documents?: PickedDocument[]) => void
  onStop: () => void
  isStreaming: boolean
  disabled?: boolean
}

export default function ChatInputBar({ onSend, onStop, isStreaming, disabled }: Props) {
  const [text, setText] = useState('')
  const [selectedImages, setSelectedImages] = useState<ImagePickerAsset[]>([])
  const [selectedDocs, setSelectedDocs] = useState<PickedDocument[]>([])
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const pickerBusy = useRef(false)
  const pendingPicker = useRef<(() => Promise<void>) | null>(null)
  const { colors } = useTheme()

  const handleSend = () => {
    const trimmed = text.trim()
    if ((!trimmed && selectedImages.length === 0 && selectedDocs.length === 0) || isStreaming) return
    onSend(
      trimmed || ' ',
      selectedImages.length > 0 ? selectedImages : undefined,
      selectedDocs.length > 0 ? selectedDocs : undefined,
    )
    setText('')
    setSelectedImages([])
    setSelectedDocs([])
  }

  /* Close menu first, then run picker after modal fully dismisses.
     iOS: onDismiss fires after the animation completes.
     Android: onDismiss is not supported, so use a setTimeout fallback. */
  const closeMenuThenPick = useCallback((picker: () => Promise<void>) => {
    pendingPicker.current = picker
    setShowAttachMenu(false)
    if (Platform.OS === 'android') {
      setTimeout(() => {
        const fn = pendingPicker.current
        pendingPicker.current = null
        if (fn) fn()
      }, 400)
    }
  }, [])

  const onMenuDismiss = useCallback(() => {
    const fn = pendingPicker.current
    pendingPicker.current = null
    if (fn) fn()
  }, [])

  const pickPhoto = async () => {
    if (pickerBusy.current) return
    pickerBusy.current = true
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8,
        base64: true,
      })
      if (!result.canceled) {
        setSelectedImages(prev => [...prev, ...result.assets].slice(0, 4))
      }
    } finally {
      pickerBusy.current = false
    }
  }

  const pickCamera = async () => {
    if (pickerBusy.current) return
    pickerBusy.current = true
    try {
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.8,
        base64: true,
      })
      if (!result.canceled) {
        setSelectedImages(prev => [...prev, ...result.assets].slice(0, 4))
      }
    } finally {
      pickerBusy.current = false
    }
  }

  const pickFile = async () => {
    if (pickerBusy.current) return
    pickerBusy.current = true
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: SUPPORTED_DOC_TYPES,
        multiple: true,
        copyToCacheDirectory: true,
      })
      if (result.canceled) return
      const picked: PickedDocument[] = []
      for (const asset of result.assets) {
        const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' as any })
        picked.push({ name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream', base64: b64 })
      }
      setSelectedDocs(prev => [...prev, ...picked].slice(0, 4))
    } finally {
      pickerBusy.current = false
    }
  }

  const handlePickPhoto = () => closeMenuThenPick(pickPhoto)
  const handleCamera = () => closeMenuThenPick(pickCamera)
  const handlePickFile = () => closeMenuThenPick(pickFile)

  const removeImage = (index: number) => setSelectedImages(prev => prev.filter((_, i) => i !== index))
  const removeDoc = (index: number) => setSelectedDocs(prev => prev.filter((_, i) => i !== index))

  const canSend = (text.trim().length > 0 || selectedImages.length > 0 || selectedDocs.length > 0) && !disabled

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.wrapper, { backgroundColor: colors.bg, borderTopColor: colors.border }]}>

        {/* Image preview strip */}
        {selectedImages.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={styles.previewScroll} contentContainerStyle={styles.previewContent}>
            {selectedImages.map((img, i) => (
              <View key={i} style={styles.previewItem}>
                <Image source={{ uri: img.uri }} style={styles.previewImage} />
                <Pressable style={[styles.removeBtn, { backgroundColor: colors.textSecondary }]}
                  onPress={() => removeImage(i)} hitSlop={8}>
                  <Ionicons name="close" size={10} color={colors.textInverse} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Document preview strip */}
        {selectedDocs.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={styles.previewScroll} contentContainerStyle={styles.previewContent}>
            {selectedDocs.map((doc, i) => (
              <View key={i} style={[styles.docBadge, { backgroundColor: colors.toolChipBg, borderColor: colors.border }]}>
                <Ionicons name="document-text-outline" size={14} color={colors.textSecondary} />
                <Text style={[styles.docName, { color: colors.textSecondary }]} numberOfLines={1}>{doc.name}</Text>
                <Pressable onPress={() => removeDoc(i)} hitSlop={8}>
                  <Ionicons name="close-circle" size={14} color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Input row */}
        <View style={styles.inputRow}>
          {/* + attach button */}
          <Pressable
            style={[styles.iconBtn, { backgroundColor: colors.bgSecondary }]}
            onPress={() => setShowAttachMenu(true)}
            disabled={isStreaming || disabled}
            accessibilityLabel="Attach"
          >
            <Ionicons name="add" size={22}
              color={isStreaming || disabled ? colors.textMuted : colors.textSecondary} />
          </Pressable>

          <TextInput
            style={[styles.input, { backgroundColor: colors.bgInput, color: colors.text }]}
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor={colors.textMuted}
            multiline
            returnKeyType="default"
            editable={!disabled && !isStreaming}
            maxLength={8000}
            accessibilityLabel="Message input"
          />

          {isStreaming ? (
            <Pressable style={[styles.sendBtn, { backgroundColor: colors.textSecondary }]}
              onPress={onStop} accessibilityLabel="Stop">
              <View style={[styles.stopIcon, { backgroundColor: colors.textInverse }]} />
            </Pressable>
          ) : (
            <Pressable style={[styles.sendBtn, { backgroundColor: canSend ? colors.primary : colors.border }]}
              onPress={handleSend} disabled={!canSend} accessibilityLabel="Send message">
              <Ionicons name="arrow-up" size={22} color={colors.textInverse} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Attach menu sheet */}
      <Modal
        visible={showAttachMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAttachMenu(false)}
        onDismiss={onMenuDismiss}
      >
        <TouchableWithoutFeedback onPress={() => setShowAttachMenu(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.sheet, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <AttachOption icon="image-outline" label="Photo" onPress={handlePickPhoto} colors={colors} />
                <View style={[styles.separator, { backgroundColor: colors.border }]} />
                <AttachOption icon="camera-outline" label="Camera" onPress={handleCamera} colors={colors} />
                <View style={[styles.separator, { backgroundColor: colors.border }]} />
                <AttachOption icon="document-attach-outline" label="File" onPress={handlePickFile} colors={colors} />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </KeyboardAvoidingView>
  )
}

function AttachOption({ icon, label, onPress, colors }: {
  icon: React.ComponentProps<typeof Ionicons>['name']
  label: string
  onPress: () => void
  colors: any
}) {
  return (
    <Pressable style={({ pressed }) => [styles.option, { opacity: pressed ? 0.6 : 1 }]} onPress={onPress}>
      <Ionicons name={icon} size={22} color={colors.text} />
      <Text style={[styles.optionLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  previewScroll: { maxHeight: 80 },
  previewContent: { paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  previewItem: { position: 'relative' },
  previewImage: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#ddd' },
  removeBtn: {
    position: 'absolute', top: -4, right: -4,
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  docBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1, maxWidth: 200,
  },
  docName: { fontSize: 12, flexShrink: 1 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingTop: 10, gap: 8,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120, borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 15,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stopIcon: { width: 14, height: 14, borderRadius: 2 },
  // Attach menu
  overlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingBottom: 100,
    paddingHorizontal: 16,
  },
  sheet: {
    alignSelf: 'flex-start',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    minWidth: 160,
  },
  option: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, paddingHorizontal: 18, paddingVertical: 14,
  },
  optionLabel: { fontSize: 16 },
  separator: { height: StyleSheet.hairlineWidth },
})
