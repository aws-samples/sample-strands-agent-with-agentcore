'use client';

import React, { useState, useEffect } from 'react';
import { Settings, Eye, EyeOff, X, Loader2, ExternalLink } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

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
      <div key={keyName} className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground w-20 shrink-0">{label}</span>

        {isEditing ? (
          // Edit mode - active input
          <div className="flex-1 flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type={showValue ? 'text' : 'password'}
                placeholder="Enter key..."
                value={newValues[keyName] || ''}
                onChange={(e) => handleValueChange(keyName, e.target.value)}
                className="h-9 text-sm pr-9"
                autoFocus
                disabled={isSaving}
              />
              <button
                type="button"
                onClick={() => toggleShowValue(keyName)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={() => handleSaveKey(keyName)}
              disabled={isSaving || !newValues[keyName]?.trim()}
              className="h-8 px-3 text-sm"
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
                className="h-9 text-sm pr-9 bg-primary/5 text-primary cursor-default"
              />
              <button
                type="button"
                onClick={() => toggleShowValue(keyName)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStartEdit(keyName)}
              disabled={isSaving}
              className="h-8 px-3 text-sm"
            >
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleClearKey(keyName)}
              disabled={isSaving}
              className="h-8 px-3 text-sm text-destructive hover:text-destructive"
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
              className="h-9 text-sm flex-1 bg-primary/5 text-primary/80"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStartEdit(keyName)}
              className="h-8 px-3 text-sm"
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
              className="h-9 text-sm flex-1 bg-destructive/5 placeholder:text-destructive/60"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStartEdit(keyName)}
              className="h-8 px-3 text-sm"
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            API Keys
          </DialogTitle>
          <DialogDescription>
            Configure API keys for external services
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            API_KEY_SECTIONS.map((section, index) => (
              <div key={section.id}>
                {index > 0 && <div className="border-t border-border/50 mb-5" />}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium">{section.title}</h4>
                    <a
                      href={section.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
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
