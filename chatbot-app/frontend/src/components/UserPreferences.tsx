'use client'

import { useState, useEffect } from 'react'
import { Settings, Moon, Sun, Globe, Bell, Save, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * User preferences interface
 */
export interface UserPreferences {
  theme: 'light' | 'dark' | 'system'
  language: string
  notifications: {
    email: boolean
    browser: boolean
    sessionExpiry: boolean
  }
}

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  language: 'en',
  notifications: {
    email: true,
    browser: true,
    sessionExpiry: true,
  },
}

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '中文' },
]

interface UserPreferencesProps {
  userId?: string
  onSave?: (preferences: UserPreferences) => Promise<void>
  trigger?: React.ReactNode
}

/**
 * User Preferences Dialog
 * 
 * Allows users to customize their experience with theme, language,
 * and notification preferences.
 */
export function UserPreferences({ userId, onSave, trigger }: UserPreferencesProps) {
  const [open, setOpen] = useState(false)
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Load preferences on mount
  useEffect(() => {
    if (open && userId) {
      loadPreferences()
    }
  }, [open, userId])

  const loadPreferences = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/users/me/preferences')
      if (response.ok) {
        const data = await response.json()
        if (data.preferences) {
          setPreferences({ ...DEFAULT_PREFERENCES, ...data.preferences })
        }
      }
    } catch (error) {
      console.error('[Preferences] Failed to load:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (onSave) {
        await onSave(preferences)
      } else {
        const response = await fetch('/api/users/me/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences }),
        })
        if (!response.ok) {
          throw new Error('Failed to save preferences')
        }
      }
      setHasChanges(false)
      setOpen(false)
    } catch (error) {
      console.error('[Preferences] Failed to save:', error)
    } finally {
      setSaving(false)
    }
  }

  const updatePreference = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    setPreferences(prev => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }

  const updateNotification = (key: keyof UserPreferences['notifications'], value: boolean) => {
    setPreferences(prev => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: value },
    }))
    setHasChanges(true)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon">
            <Settings className="h-5 w-5" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Preferences
          </DialogTitle>
          <DialogDescription>
            Customize your experience. Changes are saved automatically.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Theme Selection */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                {preferences.theme === 'dark' ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Sun className="h-4 w-4" />
                )}
                Theme
              </Label>
              <Select
                value={preferences.theme}
                onValueChange={(value) =>
                  updatePreference('theme', value as 'light' | 'dark' | 'system')
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Language Selection */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Language
              </Label>
              <Select
                value={preferences.language}
                onValueChange={(value) => updatePreference('language', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notification Preferences */}
            <div className="space-y-4">
              <Label className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Notifications
              </Label>

              <div className="space-y-3 pl-6">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-normal">
                    Email notifications
                  </Label>
                  <Switch
                    checked={preferences.notifications.email}
                    onCheckedChange={(checked) => updateNotification('email', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-sm font-normal">
                    Browser notifications
                  </Label>
                  <Switch
                    checked={preferences.notifications.browser}
                    onCheckedChange={(checked) => updateNotification('browser', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-sm font-normal">
                    Session expiry warnings
                  </Label>
                  <Switch
                    checked={preferences.notifications.sessionExpiry}
                    onCheckedChange={(checked) => updateNotification('sessionExpiry', checked)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default UserPreferences
