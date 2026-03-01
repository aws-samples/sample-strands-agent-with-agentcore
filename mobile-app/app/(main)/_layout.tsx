import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SessionProvider } from '@/context/SessionContext'
import { ArtifactProvider, useArtifactContext } from '@/context/ArtifactContext'
import { useTheme } from '@/context/ThemeContext'

function MainTabs() {
  const { unreadCount } = useArtifactContext()
  const { colors } = useTheme()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="canvas"
        options={{
          title: 'Canvas',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="albums-outline" size={size} color={color} />
          ),
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary },
        }}
      />
    </Tabs>
  )
}

export default function MainLayout() {
  return (
    <SessionProvider>
      <ArtifactProvider>
        <MainTabs />
      </ArtifactProvider>
    </SessionProvider>
  )
}
