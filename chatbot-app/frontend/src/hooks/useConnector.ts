import React, { useState, useCallback, useEffect, useMemo, useContext, createContext } from 'react'
import { apiGet, apiPut } from '@/lib/api-client'

export interface SkillInfo {
  name: string
  description: string
  source: string
}

interface ConnectorState {
  allSkills: SkillInfo[]
  disabledSkills: Set<string>
  isLoading: boolean
  toggleSkill: (skillName: string) => void
  saveDisabledSkills: () => Promise<void>
}

const ConnectorContext = createContext<ConnectorState | null>(null)

export function ConnectorProvider({ children }: { children: React.ReactNode }) {
  const [allSkills, setAllSkills] = useState<SkillInfo[]>([])
  const [disabledSkills, setDisabledSkills] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [skillsRes, disabledRes] = await Promise.all([
          apiGet<{ skills: SkillInfo[] }>('skills'),
          apiGet<{ disabledSkills: string[] }>('skills/disabled'),
        ])
        setAllSkills(skillsRes.skills || [])
        setDisabledSkills(new Set(disabledRes.disabledSkills || []))
      } catch (e) {
        console.error('[Connector] Failed to load skills:', e)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const toggleSkill = useCallback((skillName: string) => {
    setDisabledSkills(prev => {
      const next = new Set(prev)
      if (next.has(skillName)) {
        next.delete(skillName)
      } else {
        next.add(skillName)
      }
      return next
    })
  }, [])

  const saveDisabledSkills = useCallback(async () => {
    const current = disabledSkills
    await apiPut('skills/disabled', { disabledSkills: Array.from(current) })
  }, [disabledSkills])

  const value = useMemo(() => ({
    allSkills, disabledSkills, isLoading, toggleSkill, saveDisabledSkills,
  }), [allSkills, disabledSkills, isLoading, toggleSkill, saveDisabledSkills])

  return React.createElement(ConnectorContext.Provider, { value }, children)
}

export function useConnector(): ConnectorState {
  const ctx = useContext(ConnectorContext)
  if (!ctx) {
    return {
      allSkills: [],
      disabledSkills: new Set(),
      isLoading: false,
      toggleSkill: () => {},
      saveDisabledSkills: async () => {},
    }
  }
  return ctx
}
