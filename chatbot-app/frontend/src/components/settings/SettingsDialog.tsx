'use client';

import React, { useState, useEffect } from 'react';
import { Settings, Eye, EyeOff, X, RefreshCw, ExternalLink } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ApiKeyConfig {
  configured: boolean;
  masked: string | null;
  value: string | null;
}

interface ApiKeysResponse {
  success: boolean;
  user_keys: Record<string, ApiKeyConfig>;
  default_keys: Record<string, { configured: boolean }>;
}

// API Key definitions for UI
const API_KEY_SECTIONS = [
  {
    id: 'tavily',
    title: 'Tavily',
    link: 'https://app.tavily.com',
    keys: [{ name: 'tavily_api_key', label: 'API Key' }],
  },
  {
    id: 'google_search',
    title: 'Google Search',
    link: 'https://developers.google.com/custom-search/v1/overview',
    keys: [
      { name: 'google_api_key', label: 'API Key' },
      { name: 'google_search_engine_id', label: 'Engine ID' },
    ],
  },
  {
    id: 'google_maps',
    title: 'Google Maps',
    link: 'https://developers.google.com/maps/documentation/javascript/get-api-key',
    keys: [{ name: 'google_maps_api_key', label: 'API Key' }],
  },
  {
    id: 'nova_act',
    title: 'Nova Act',
    link: 'https://nova.amazon.com/dev/api',
    keys: [{ name: 'nova_act_api_key', label: 'API Key' }],
  },
];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [userKeys, setUserKeys] = useState<Record<string, ApiKeyConfig>>({});
  const [defaultKeys, setDefaultKeys] = useState<Record<string, { configured: boolean }>>({});
  const [editingKeys, setEditingKeys] = useState<Record<string, boolean>>({});
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) {
      loadApiKeys();
    } else {
      setEditingKeys({});
      setNewValues({});
      setShowValues({});
    }
  }, [open]);

  const loadApiKeys = async () => {
    setLoading(true);
    try {
      const data = await apiGet<ApiKeysResponse>('settings/api-keys');
      if (data.success) {
        setUserKeys(data.user_keys || {});
        setDefaultKeys(data.default_keys || {});
      }
    } catch (error) {
      console.error('Failed to load API keys:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (keyName: string) => {
    setEditingKeys((prev) => ({ ...prev, [keyName]: true }));
    setNewValues((prev) => ({ ...prev, [keyName]: '' }));
  };

  const handleCancelEdit = (keyName: string) => {
    setEditingKeys((prev) => ({ ...prev, [keyName]: false }));
    setNewValues((prev) => {
      const updated = { ...prev };
      delete updated[keyName];
      return updated;
    });
  };

  const handleValueChange = (keyName: string, value: string) => {
    setNewValues((prev) => ({ ...prev, [keyName]: value }));
  };

  const handleSaveKey = async (keyName: string) => {
    const value = newValues[keyName];
    if (!value || !value.trim()) return;

    setSavingKey(keyName);
    try {
      await apiPost('settings/api-keys', { [keyName]: value });
      await loadApiKeys();
      setEditingKeys((prev) => ({ ...prev, [keyName]: false }));
      setNewValues((prev) => {
        const updated = { ...prev };
        delete updated[keyName];
        return updated;
      });
    } catch (error) {
      console.error('Failed to save API key:', error);
    } finally {
      setSavingKey(null);
    }
  };

  const handleClearKey = async (keyName: string) => {
    setSavingKey(keyName);
    try {
      await apiPost('settings/api-keys', { [keyName]: null });
      await loadApiKeys();
    } catch (error) {
      console.error('Failed to clear API key:', error);
    } finally {
      setSavingKey(null);
    }
  };

  const toggleShowValue = (keyName: string) => {
    setShowValues((prev) => ({ ...prev, [keyName]: !prev[keyName] }));
  };

  const renderKeyField = (keyName: string, label: string) => {
    const userKey = userKeys[keyName] || { configured: false, masked: null, value: null };
    const defaultKey = defaultKeys[keyName] || { configured: false };
    const isEditing = editingKeys[keyName];
    const showValue = showValues[keyName];
    const hasUserKey = userKey.configured;
    const hasDefaultKey = defaultKey.configured;
    const isSaving = savingKey === keyName;

    return (
      <div key={keyName} className="flex items-center gap-2">
        <span className="text-xs text-foreground/70 w-16 shrink-0">{label}</span>

        {isEditing ? (
          // Edit mode - active input
          <div className="flex-1 flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type={showValue ? 'text' : 'password'}
                placeholder="Enter key..."
                value={newValues[keyName] || ''}
                onChange={(e) => handleValueChange(keyName, e.target.value)}
                className="h-8 text-xs pr-8"
                autoFocus
                disabled={isSaving}
              />
              <button
                type="button"
                onClick={() => toggleShowValue(keyName)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={() => handleSaveKey(keyName)}
              disabled={isSaving || !newValues[keyName]?.trim()}
              className="h-7 px-3 text-xs"
            >
              {isSaving ? '...' : 'Set'}
            </Button>
            <button
              onClick={() => handleCancelEdit(keyName)}
              className="text-muted-foreground hover:text-foreground p-1"
              disabled={isSaving}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : hasUserKey ? (
          // User key - show masked with actions
          <div className="flex-1 flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type="text"
                value={showValue ? userKey.value || '' : userKey.masked || ''}
                readOnly
                className="h-8 text-xs pr-8 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700/80 dark:text-blue-400/90 cursor-default"
              />
              <button
                type="button"
                onClick={() => toggleShowValue(keyName)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStartEdit(keyName)}
              disabled={isSaving}
              className="h-7 px-2 text-xs"
            >
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleClearKey(keyName)}
              disabled={isSaving}
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            >
              {isSaving ? '...' : 'Clear'}
            </Button>
          </div>
        ) : hasDefaultKey ? (
          // Default key - disabled input style
          <div className="flex-1 flex items-center gap-2">
            <Input
              type="text"
              value="••••••••  (shared key active)"
              disabled
              className="h-8 text-xs flex-1 bg-blue-50/70 dark:bg-blue-950/40 text-blue-600/80 dark:text-blue-400/80"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStartEdit(keyName)}
              className="h-7 px-2 text-xs"
            >
              Override
            </Button>
          </div>
        ) : (
          // Not configured - empty disabled input
          <div className="flex-1 flex items-center gap-2">
            <Input
              type="text"
              value=""
              placeholder="Not configured"
              disabled
              className="h-8 text-xs flex-1 bg-red-50/60 dark:bg-red-950/30 placeholder:text-red-500/80 dark:placeholder:text-red-400/70"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStartEdit(keyName)}
              className="h-7 px-2 text-xs"
            >
              Add
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <Settings className="h-4 w-4" />
            API Keys
          </DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            API_KEY_SECTIONS.map((section, index) => (
              <div key={section.id}>
                {index > 0 && <div className="border-t border-border/50 mb-4" />}
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-medium">{section.title}</h4>
                    <a
                      href={section.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground/40 hover:text-foreground/70 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {section.keys.map((keyDef) => renderKeyField(keyDef.name, keyDef.label))}
                </div>
              </div>
            ))
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}
