'use client';

import React, { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

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
}

export function ModelConfigDialog({ sessionId, trigger }: ModelConfigDialogProps) {
  const [loading, setLoading] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<ModelConfig | null>(null);
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
