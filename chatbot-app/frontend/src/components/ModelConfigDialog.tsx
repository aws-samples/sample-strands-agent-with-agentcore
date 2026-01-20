'use client';

import React, { useState, useEffect } from 'react';
import { ChevronDown, AudioWaveform } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import type { AgentStatus } from '@/types/events';

interface ModelConfig {
  model_id: string;
}

interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  description: string;
}

interface ModelConfigDialogProps {
  sessionId: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  agentStatus?: AgentStatus;
}

export function ModelConfigDialog({ sessionId, trigger, agentStatus }: ModelConfigDialogProps) {
  const [loading, setLoading] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<ModelConfig | null>(null);

  const isVoiceActive = agentStatus?.startsWith('voice_');
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  // Update local state when current config changes
  useEffect(() => {
    if (currentConfig) {
      setSelectedModelId(currentConfig.model_id);
    }
  }, [currentConfig]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadModelConfig(),
        loadAvailableModels()
      ]);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadModelConfig = async () => {
    try {
      const data = await apiGet<{ success: boolean; config: any }>(
        'model/config',
        {
          headers: sessionId ? { 'X-Session-ID': sessionId } : {},
        }
      );

      if (data.success && data.config) {
        setCurrentConfig({
          model_id: data.config.model_id,
        });
      }
    } catch (error) {
      console.error('Failed to load model config:', error);
    }
  };

  const loadAvailableModels = async () => {
    try {
      const data = await apiGet<{ models: AvailableModel[] }>(
        'model/available-models',
        {
          headers: sessionId ? { 'X-Session-ID': sessionId } : {},
        }
      );

      setAvailableModels(data.models || []);
    } catch (error) {
      console.error('Failed to load available models:', error);
    }
  };

  const handleModelChange = async (modelId: string) => {
    setSelectedModelId(modelId);

    try {
      await apiPost(
        'model/config/update',
        {
          model_id: modelId,
        },
        {
          headers: sessionId ? { 'X-Session-ID': sessionId } : {},
        }
      );

      // Update currentConfig after successful API call
      setCurrentConfig({ model_id: modelId });
    } catch (error) {
      console.error('Failed to update model:', error);
      // Revert on error
      if (currentConfig) {
        setSelectedModelId(currentConfig.model_id);
      }
    }
  };

  const selectedModel = availableModels.find(m => m.id === selectedModelId);

  if (loading) {
    return (
      <div className="h-7 px-3 flex items-center text-xs text-muted-foreground">
        Loading...
      </div>
    );
  }

  // Voice mode active - show special Nova Sonic 2 badge
  if (isVoiceActive) {
    return (
      <div className="relative group">
        {/* Animated gradient border */}
        <div className="absolute -inset-[1px] rounded-lg bg-gradient-to-r from-violet-500 via-fuchsia-500 via-pink-500 via-rose-500 via-orange-500 via-amber-500 via-yellow-500 via-lime-500 via-green-500 via-emerald-500 via-teal-500 via-cyan-500 via-sky-500 via-blue-500 via-indigo-500 to-violet-500 opacity-75 blur-[2px] animate-gradient-x" />
        <div className="absolute -inset-[1px] rounded-lg bg-gradient-to-r from-violet-500 via-fuchsia-500 via-pink-500 via-rose-500 via-orange-500 via-amber-500 via-yellow-500 via-lime-500 via-green-500 via-emerald-500 via-teal-500 via-cyan-500 via-sky-500 via-blue-500 via-indigo-500 to-violet-500 opacity-50 animate-gradient-x" />

        {/* Content */}
        <div className="relative h-7 px-3 flex items-center gap-2 text-xs font-semibold bg-background rounded-lg cursor-default">
          <AudioWaveform className="w-3.5 h-3.5 text-fuchsia-500 animate-pulse" />
          <span className="bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent">
            Nova Sonic 2
          </span>
        </div>
      </div>
    );
  }

  return (
    <Select value={selectedModelId} onValueChange={handleModelChange}>
      <SelectTrigger className="h-7 px-3 text-xs font-medium text-muted-foreground/70 border-0 hover:bg-muted-foreground/10 transition-all duration-200 focus:ring-0 focus:ring-offset-0 bg-transparent">
        <span className="truncate">
          {selectedModel ? selectedModel.name : 'Select model'}
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-[300px] overflow-y-auto">
        {availableModels.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            <div className="flex flex-col items-start py-1">
              <div className="font-medium">{model.name}</div>
              <div className="text-xs text-muted-foreground">
                {model.description}
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
