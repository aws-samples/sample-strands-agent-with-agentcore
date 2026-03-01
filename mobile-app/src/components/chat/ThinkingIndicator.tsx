import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../context/ThemeContext'

interface Props {
  label?: string
}

function Dot({ delay, color }: { delay: number; color: string }) {
  const anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.delay(600),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [anim, delay])

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -5] })

  return (
    <Animated.View style={[styles.dot, { backgroundColor: color, transform: [{ translateY }] }]} />
  )
}

export default function ThinkingIndicator({ label }: Props) {
  const { colors } = useTheme()

  return (
    <View style={styles.container}>
      <View style={[styles.bubble, { backgroundColor: colors.bgSecondary }]}>
        <View style={styles.dots}>
          <Dot delay={0} color={colors.textMuted} />
          <Dot delay={150} color={colors.textMuted} />
          <Dot delay={300} color={colors.textMuted} />
        </View>
      </View>
      {label ? <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'flex-start', marginVertical: 6, paddingHorizontal: 12 },
  bubble: {
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: { fontSize: 12, marginTop: 4, marginLeft: 8 },
})
