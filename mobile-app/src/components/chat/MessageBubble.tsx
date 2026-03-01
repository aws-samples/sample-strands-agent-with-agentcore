import React, { memo } from 'react'
import { View } from 'react-native'
import type { Message } from '../../types/chat'
import UserBubble from './UserBubble'
import AssistantTurn from './AssistantTurn'
import ErrorBanner from '../events/ErrorBanner'

interface Props {
  message: Message
}

/**
 * Top-level message switcher.
 * - user      → right-aligned blue bubble
 * - assistant → left-aligned white card with all event blocks
 * - error     → red ErrorBanner
 * - warning   → yellow ErrorBanner
 */
function MessageBubble({ message }: Props) {
  switch (message.role) {
    case 'user':
      return <UserBubble message={message} />
    case 'assistant':
      return <AssistantTurn message={message} />
    case 'error':
      return (
        <View style={{ paddingHorizontal: 12, marginVertical: 4 }}>
          <ErrorBanner message={message.text} variant="error" />
        </View>
      )
    case 'warning':
      return (
        <View style={{ paddingHorizontal: 12, marginVertical: 4 }}>
          <ErrorBanner message={message.text} variant="warning" />
        </View>
      )
    default:
      return null
  }
}

export default memo(MessageBubble)
