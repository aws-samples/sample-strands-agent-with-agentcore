import React, { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../context/ThemeContext'
import type { ToolExecution } from '../../types/chat'
import { resolveToolIcon } from '../../config/tool-icons'
import ToolIcon from './ToolIcon'
import ToolResultModal from './ToolResultModal'

interface Props {
  toolExecutions: ToolExecution[]
}

type ToolGroup = {
  key: string
  executions: ToolExecution[]
}

// Derive a stable grouping key from tool name + input
function getGroupKey(toolName: string, toolInput?: string): string {
  return resolveDisplayName(toolName, toolInput)
}

/** Resolve a human-friendly display name for a tool.
 *  For skill_dispatcher/skill_executor, extract the inner skill or tool name. */
export function resolveDisplayName(toolName: string, toolInput?: string): string {
  if ((toolName === 'skill_dispatcher' || toolName === 'skill_executor') && toolInput) {
    try {
      const parsed = JSON.parse(toolInput) as Record<string, unknown>
      const inner = (parsed.skill_name ?? parsed.skill ?? parsed.tool_name) as string | undefined
      if (inner) return inner
    } catch { /* ignore */ }
  }
  return toolName
}

export default function ToolIconRow({ toolExecutions }: Props) {
  const { colors } = useTheme()
  const [selectedGroup, setSelectedGroup] = useState<ToolGroup | null>(null)

  if (toolExecutions.length === 0) return null

  // Group consecutive same-icon tools (skip skill_dispatcher)
  const groups: ToolGroup[] = []
  const groupMap = new Map<string, ToolGroup>()
  for (const tool of toolExecutions) {
    if (tool.toolName === 'skill_dispatcher') continue
    const key = getGroupKey(tool.toolName, tool.toolInput)
    if (groupMap.has(key)) {
      groupMap.get(key)!.executions.push(tool)
    } else {
      const group: ToolGroup = { key, executions: [tool] }
      groups.push(group)
      groupMap.set(key, group)
    }
  }

  if (groups.length === 0) return null

  const selectedEntry = selectedGroup
    ? resolveToolIcon(selectedGroup.executions[0].toolName, selectedGroup.executions[0].toolInput)
    : null

  return (
    <>
      <View style={[styles.strip, { borderColor: colors.border, backgroundColor: colors.toolChipBg }]}>
        {groups.map((group, idx) => {
          const rep = group.executions[0]
          const entry = resolveToolIcon(rep.toolName, rep.toolInput)
          const allDone = group.executions.every(t => t.isComplete)
          const doneCount = group.executions.filter(t => t.isComplete).length
          const count = group.executions.length
          const isRunning = !allDone

          return (
            <React.Fragment key={group.key}>
              {idx > 0 && (
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.item,
                  { opacity: pressed ? 0.5 : isRunning ? 0.55 : 1 },
                ]}
                onPress={() => !isRunning && setSelectedGroup(group)}
                disabled={isRunning}
                hitSlop={4}
              >
                {isRunning ? (
                  <ActivityIndicator size="small" color={colors.toolChipText} style={styles.spinner} />
                ) : (
                  <ToolIcon entry={entry} size={15} color={colors.toolChipText} />
                )}
                {count > 1 && (
                  <Text style={[styles.badge, { color: colors.textMuted }]}>
                    {allDone ? `×${count}` : `${doneCount}/${count}`}
                  </Text>
                )}
              </Pressable>
            </React.Fragment>
          )
        })}
      </View>

      {selectedGroup && (
        <ToolResultModal
          visible
          executions={selectedGroup.executions}
          iconEntry={selectedEntry}
          onClose={() => setSelectedGroup(null)}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 6,
    overflow: 'hidden',
    height: 28,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    height: '100%',
    gap: 3,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 16,
  },
  spinner: {
    width: 14,
    height: 14,
  },
  badge: {
    fontSize: 10,
    fontWeight: '600',
  },
})
