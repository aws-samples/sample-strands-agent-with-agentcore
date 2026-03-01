import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, NativeScrollEvent, NativeSyntheticEvent, Pressable, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'
import type { Message } from '../../types/chat'
import MessageBubble from './MessageBubble'
import ThinkingIndicator from './ThinkingIndicator'

interface Props {
  messages: Message[]
  isThinking: boolean
  thinkingLabel: string
  hasMore?: boolean
  onLoadMore?: () => void
}

export default function MessageList({ messages, isThinking, thinkingLabel, hasMore, onLoadMore }: Props) {
  const { colors } = useTheme()
  const flatListRef = useRef<FlatList>(null)
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false)
  const loadMoreGuard = useRef(false)
  // Suppress scroll-up detection until the first user-initiated scroll
  const hasUserScrolled = useRef(false)

  // Auto-scroll to bottom on new content (unless user scrolled up)
  // Throttled: scroll immediately if cooldown has passed, otherwise schedule end-of-cooldown scroll
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScrollTimeRef = useRef(0)
  const SCROLL_COOLDOWN_MS = 120
  const lastMsg = messages[messages.length - 1]
  // Include text-length bucket so scroll fires during streaming as text grows
  const textBucket = lastMsg?.isStreaming ? Math.floor((lastMsg?.text?.length ?? 0) / 150) : 0
  const scrollTrigger = `${messages.length}:${lastMsg?.toolExecutions?.length ?? 0}:${lastMsg?.isStreaming ?? false}:${textBucket}`

  useEffect(() => {
    if (messages.length === 0 || isUserScrolledUp) return
    const now = Date.now()
    const elapsed = now - lastScrollTimeRef.current
    if (elapsed >= SCROLL_COOLDOWN_MS) {
      // Enough time passed — scroll immediately
      flatListRef.current?.scrollToEnd({ animated: false })
      lastScrollTimeRef.current = now
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current)
        scrollTimerRef.current = null
      }
    } else {
      // Too soon — schedule a scroll at the end of the cooldown window
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
      scrollTimerRef.current = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false })
        lastScrollTimeRef.current = Date.now()
        scrollTimerRef.current = null
      }, SCROLL_COOLDOWN_MS - elapsed)
    }
  }, [scrollTrigger, isThinking, isUserScrolledUp])

  // Reset scroll state when message list changes significantly (e.g. session switch)
  const prevCountRef = useRef(messages.length)
  useEffect(() => {
    const prev = prevCountRef.current
    prevCountRef.current = messages.length
    // If messages were replaced (not appended), reset scroll state
    if (messages.length > 0 && prev === 0) {
      setIsUserScrolledUp(false)
      hasUserScrolled.current = false
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false })
      }, 100)
    }
  }, [messages.length])

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent

      // Ignore layout-triggered scroll events before user interaction
      if (!hasUserScrolled.current) return

      const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y

      // User scrolled up detection
      setIsUserScrolledUp(distanceFromBottom > 150)

      // Near top — load more older messages
      if (contentOffset.y < 100 && hasMore && onLoadMore && !loadMoreGuard.current) {
        loadMoreGuard.current = true
        onLoadMore()
        setTimeout(() => { loadMoreGuard.current = false }, 300)
      }
    },
    [hasMore, onLoadMore],
  )

  const handleScrollBeginDrag = useCallback(() => {
    hasUserScrolled.current = true
  }, [])

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true })
    setIsUserScrolledUp(false)
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <MessageBubble message={item} />
    ),
    [],
  )

  const keyExtractor = useCallback((item: Message) => item.id, [])

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        maxToRenderPerBatch={8}
        windowSize={7}
        initialNumToRender={10}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        scrollEventThrottle={100}
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        ListHeaderComponent={
          hasMore ? (
            <View style={styles.loadMoreRow}>
              <ActivityIndicator size="small" color={colors.textMuted} />
            </View>
          ) : null
        }
        ListFooterComponent={
          isThinking ? (
            <View style={styles.thinkingRow}>
              <ThinkingIndicator label={thinkingLabel} />
            </View>
          ) : null
        }
      />

      {isUserScrolledUp && (
        <Pressable
          style={[styles.scrollToBottomBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={scrollToBottom}
        >
          <Ionicons name="chevron-down" size={20} color={colors.text} />
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 16,
    paddingBottom: 8,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  loadMoreRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  thinkingRow: {
    paddingVertical: 4,
  },
  scrollToBottomBtn: {
    position: 'absolute',
    bottom: 8,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
})
