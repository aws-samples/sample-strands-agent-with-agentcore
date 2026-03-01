import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  Dimensions,
  TouchableWithoutFeedback,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ChatScreen from '@/components/chat/ChatScreen';
import SessionListItem from '@/components/sessions/SessionListItem';
import { useSessionContext } from '@/context/SessionContext';
import { useAuthContext } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useSessions } from '@/hooks/useSessions';
import { generateSessionId } from '@/lib/auth';
import type { SessionMeta } from '@/types/chat';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = SCREEN_WIDTH * 0.82;

export default function ChatTab() {
  const { activeSessionId, setActiveSessionId } = useSessionContext();
  const { user, signOut } = useAuthContext();
  const { colors } = useTheme();
  const { sessions, loading, loadSessions, createSession, deleteSession } = useSessions();
  const insets = useSafeAreaInsets();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnim, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [slideAnim, overlayAnim]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -DRAWER_WIDTH,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [slideAnim, overlayAnim]);

  useEffect(() => {
    if (drawerOpen) loadSessions();
  }, [drawerOpen, loadSessions]);

  const handleSelect = useCallback(
    (session: SessionMeta) => {
      setActiveSessionId(session.sessionId);
      closeDrawer();
    },
    [setActiveSessionId, closeDrawer],
  );

  const handleNew = useCallback(async () => {
    try {
      let sid: string;
      try {
        sid = await createSession();
      } catch {
        sid = user?.userId
          ? generateSessionId(user.userId)
          : `local_${Date.now().toString(36)}`;
      }
      setActiveSessionId(sid);
      closeDrawer();
    } catch {
      Alert.alert('Error', 'Could not create a new session');
    }
  }, [createSession, user, setActiveSessionId, closeDrawer]);

  const handleNewFromHeader = useCallback(async () => {
    try {
      let sid: string;
      try {
        sid = await createSession();
      } catch {
        sid = user?.userId
          ? generateSessionId(user.userId)
          : `local_${Date.now().toString(36)}`;
      }
      setActiveSessionId(sid);
    } catch {
      Alert.alert('Error', 'Could not create a new session');
    }
  }, [createSession, user, setActiveSessionId]);

  const handleDelete = useCallback(
    (sessionId: string) => {
      Alert.alert('Delete conversation', 'Remove this conversation?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteSession(sessionId).catch(() =>
              Alert.alert('Error', 'Could not delete session'),
            ),
        },
      ]);
    },
    [deleteSession],
  );

  const NewChatRow = () => (
    <Pressable
      style={[styles.newChatRow, { borderBottomColor: colors.border }]}
      onPress={handleNew}
    >
      <Ionicons name="add-circle-outline" size={18} color={colors.textMuted} />
      <Text style={[styles.newChatText, { color: colors.textSecondary }]}>New conversation</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <ChatScreen
        sessionId={activeSessionId}
        onMenuPress={openDrawer}
        onNewChat={handleNewFromHeader}
        onSignOut={signOut}
        onTitleUpdated={loadSessions}
      />

      {/* ── Overlay backdrop — always mounted, touch-blocked when closed ── */}
      <TouchableWithoutFeedback onPress={closeDrawer}>
        <Animated.View
          pointerEvents={drawerOpen ? 'auto' : 'none'}
          style={[
            styles.overlay,
            { opacity: overlayAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] }) },
          ]}
        />
      </TouchableWithoutFeedback>

      {/* ── Slide-in drawer — always mounted so SafeAreaView pre-calculates insets ── */}
      <Animated.View
        pointerEvents={drawerOpen ? 'auto' : 'none'}
        style={[
          styles.drawer,
          { width: DRAWER_WIDTH, backgroundColor: colors.bg, transform: [{ translateX: slideAnim }] },
        ]}
      >
        <View style={[styles.drawerSafe, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left }]}>
          {/* Session list */}
          {loading && sessions.length === 0 ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={sessions}
              keyExtractor={item => item.sessionId}
              ListHeaderComponent={<NewChatRow />}
              renderItem={({ item }) => (
                <SessionListItem
                  session={item}
                  isActive={item.sessionId === activeSessionId}
                  onPress={() => handleSelect(item)}
                  onDelete={() => handleDelete(item.sessionId)}
                />
              )}
              refreshing={isManualRefresh}
              onRefresh={async () => {
                setIsManualRefresh(true);
                await loadSessions();
                setIsManualRefresh(false);
              }}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <View style={styles.emptyHint}>
                  <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                    No conversations yet
                  </Text>
                </View>
              }
            />
          )}

          {/* Footer */}
          <View style={[styles.drawerFooter, { borderTopColor: colors.border }]}>
            <Text style={[styles.footerEmail, { color: colors.textMuted }]} numberOfLines={1}>
              {user?.email ?? ''}
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 10,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 10,
  },
  drawerSafe: { flex: 1 },
  newChatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  newChatText: { fontSize: 14, fontWeight: '500' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyHint: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 14 },

  list: { flexGrow: 1 },

  drawerFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerEmail: { fontSize: 13 },
});
