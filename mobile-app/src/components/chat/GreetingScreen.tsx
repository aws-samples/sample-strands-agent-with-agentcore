import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../context/ThemeContext'

export default function GreetingScreen() {
  const { colors } = useTheme()

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <Text style={[styles.greeting, { color: colors.text }]}>Hello! 👋</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        What can I help you with?
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 15,
    marginTop: 8,
  },
})
