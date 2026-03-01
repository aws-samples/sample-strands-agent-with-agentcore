import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'

interface Props {
  message: string
  variant?: 'error' | 'warning'
}

export default function ErrorBanner({ message, variant = 'error' }: Props) {
  const { colors } = useTheme()
  const isWarn = variant === 'warning'

  return (
    <View style={[styles.banner, {
      backgroundColor: isWarn ? colors.warningBg : colors.errorBg,
      borderColor: isWarn ? colors.warningBorder : colors.errorBorder,
    }]}>
      <Ionicons
        name={isWarn ? 'warning-outline' : 'close-circle-outline'}
        size={18}
        color={isWarn ? colors.warningText : colors.error}
        style={{ marginTop: 1 }}
      />
      <Text style={[styles.text, { color: isWarn ? colors.warningText : colors.error }]} numberOfLines={4}>
        {message}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 6,
    gap: 10,
    borderWidth: 1,
  },
  text: { flex: 1, fontSize: 13, lineHeight: 19 },
})
