'use client';

import React, { useState, useEffect } from 'react';
import { Settings, Brain, Thermometer, MessageSquare, Plus, Edit2, Save } from 'lucide-react';
import { getApiUrl } from '@/config/environment';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Textarea } from './ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from './ui/dialog';

interface ModelConfig {
  model_id: string;
  temperature: number;
  active_prompt: {
    id: string;
    name: string;
    prompt: string;
    active: boolean;
  } | null;
  caching?: {
    enabled: boolean;
  };
}

interface SystemPrompt {
  id: string;
  name: string;
  prompt: string;
  active: boolean;
}

interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  description: string;
}

interface ModelConfigDialogProps {
  sessionId: string | null;
}

export function ModelConfigDialog({ sessionId }: ModelConfigDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Current state from backend
  const [currentConfig, setCurrentConfig] = useState<ModelConfig | null>(null);
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  
  // Local state for editing
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedTemperature, setSelectedTemperature] = useState(0.7);
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [cachingEnabled, setCachingEnabled] = useState(true);
  
  // Prompt editing
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);
  const [showNewPromptForm, setShowNewPromptForm] = useState(false);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');


  // Load data when dialog opens
  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open]);

  // Update local state when current config changes
  useEffect(() => {
    if (currentConfig) {
      setSelectedModelId(currentConfig.model_id);
      setSelectedTemperature(currentConfig.temperature);
      setSelectedPromptId(currentConfig.active_prompt?.id || '');
      setCachingEnabled(currentConfig.caching?.enabled ?? true);
    }
  }, [currentConfig]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadModelConfig(),
        loadSystemPrompts(),
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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      // Include session ID in headers if available
      if (sessionId) {
        headers['X-Session-ID'] = sessionId;
      }
      
      const response = await fetch(getApiUrl('model/config'), {
        method: 'GET',
        headers
      });
      
      const data = await response.json();
      
      // Session ID is managed by parent component
      
      if (data.success && data.config) {
        const config = data.config;
        const activePrompt = config.system_prompts?.find((p: SystemPrompt) => p.active) || null;
        setCurrentConfig({
          model_id: config.model_id,
          temperature: config.temperature,
          active_prompt: activePrompt,
          caching: config.caching || { enabled: true }
        });
      }
    } catch (error) {
      console.error('Failed to load model config:', error);
    }
  };

  const loadSystemPrompts = async () => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (sessionId) {
        headers['X-Session-ID'] = sessionId;
      }
      
      const response = await fetch(getApiUrl('model/prompts'), {
        method: 'GET',
        headers
      });
      
      const data = await response.json();
      
      // Session ID is managed by parent component
      
      setPrompts(data.prompts || []);
    } catch (error) {
      console.error('Failed to load system prompts:', error);
    }
  };

  const loadAvailableModels = async () => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (sessionId) {
        headers['X-Session-ID'] = sessionId;
      }
      
      const response = await fetch(getApiUrl('model/available-models'), {
        method: 'GET',
        headers
      });
      
      const data = await response.json();
      
      // Session ID is managed by parent component
      
      setAvailableModels(data.models || []);
    } catch (error) {
      console.error('Failed to load available models:', error);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Update model configuration
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (sessionId) {
        headers['X-Session-ID'] = sessionId;
      }
      
      const modelResponse = await fetch(getApiUrl('model/config/update'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model_id: selectedModelId,
          temperature: selectedTemperature,
          caching: {
            enabled: cachingEnabled
          }
        }),
      });
      
      // Session ID is managed by parent component

      if (!modelResponse.ok) {
        throw new Error('Failed to update model configuration');
      }

      // Activate selected prompt if different from current
      if (selectedPromptId && selectedPromptId !== currentConfig?.active_prompt?.id) {
        const promptHeaders: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        
        if (sessionId) {
          promptHeaders['X-Session-ID'] = sessionId;
        }
        
        const promptResponse = await fetch(getApiUrl(`model/prompts/${selectedPromptId}/activate`), {
          method: 'POST',
          headers: promptHeaders,
        });

        if (!promptResponse.ok) {
          throw new Error('Failed to activate system prompt');
        }
        
        // Extract and update session ID from response headers
        // Session ID is managed by parent component
      }

      // Close with a smooth delay
      setTimeout(() => setOpen(false), 150);
    } catch (error) {
      console.error('Failed to save configuration:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePrompt = async () => {
    if (!newPromptName.trim() || !newPromptContent.trim()) return;

    setLoading(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (sessionId) {
        headers['X-Session-ID'] = sessionId;
      }
      
      const response = await fetch(getApiUrl('model/prompts'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: newPromptName,
          prompt: newPromptContent,
        }),
      });

      if (response.ok) {
        // Extract and update session ID from response headers
        // Session ID is managed by parent component
        
        setNewPromptName('');
        setNewPromptContent('');
        setShowNewPromptForm(false);
        await loadSystemPrompts();
      }
    } catch (error) {
      console.error('Failed to create prompt:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePrompt = async () => {
    if (!editingPrompt) return;

    setLoading(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (sessionId) {
        headers['X-Session-ID'] = sessionId;
      }
      
      const response = await fetch(getApiUrl(`model/prompts/${editingPrompt.id}`), {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name: editingPrompt.name,
          prompt: editingPrompt.prompt,
        }),
      });

      if (response.ok) {
        // Extract and update session ID from response headers
        // Session ID is managed by parent component
        
        setEditingPrompt(null);
        await loadSystemPrompts();
        await loadModelConfig();
      }
    } catch (error) {
      console.error('Failed to update prompt:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectedModel = availableModels.find(m => m.id === selectedModelId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          title="Model Settings"
        >
          <Brain className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg animate-in fade-in-0 duration-200">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Model Configuration
          </DialogTitle>
          <DialogDescription>
            Configure the AI model, temperature, and system prompt.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-sm text-muted-foreground">Loading...</div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Model Selection */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Brain className="h-4 w-4" />
                Model
              </Label>
              <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <div>
                        <div className="font-medium">{model.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {model.provider} - {model.description}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedModel && (
                <div className="text-xs text-muted-foreground">
                  Current: {selectedModel.name} ({selectedModel.provider})
                </div>
              )}
            </div>

            {/* Temperature */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Thermometer className="h-4 w-4" />
                Temperature: {selectedTemperature?.toFixed(1) || '0.7'}
              </Label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={selectedTemperature}
                onChange={(e) => setSelectedTemperature(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Focused (0.0)</span>
                <span>Creative (1.0)</span>
              </div>
            </div>

            {/* Caching Configuration */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Brain className="h-4 w-4" />
                Prompt Caching
              </Label>
              <div className="flex items-center justify-between p-3 bg-muted rounded-md">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Enable Prompt Caching</div>
                  <div className="text-xs text-muted-foreground">
                    Automatically adds cache points after tool execution for improved performance and reduced costs
                  </div>
                </div>
                <Switch
                  checked={cachingEnabled}
                  onCheckedChange={setCachingEnabled}
                />
              </div>
            </div>

            {/* System Prompts */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                System Prompt
              </Label>
              
              {/* Prompt Buttons Grid */}
              <div className="grid grid-cols-2 gap-2">
                {prompts.map((prompt) => (
                  <div key={prompt.id} className="relative">
                    <Button
                      variant={selectedPromptId === prompt.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedPromptId(prompt.id)}
                      className="w-full justify-start"
                    >
                      {prompt.name}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingPrompt(prompt)}
                      className="absolute -top-1 -right-1 h-5 w-5 p-0 rounded-full bg-background border"
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                
                {/* Add New Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowNewPromptForm(true)}
                  className="w-full justify-center border-dashed"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>

              {/* Selected Prompt Preview */}
              {selectedPromptId && (
                <div className="p-3 bg-muted rounded-md">
                  <div className="text-xs font-medium mb-1">
                    {prompts.find(p => p.id === selectedPromptId)?.name}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-3">
                    {prompts.find(p => p.id === selectedPromptId)?.prompt}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>

        {/* Edit Prompt Modal */}
        {editingPrompt && (
          <Dialog open={!!editingPrompt} onOpenChange={() => setEditingPrompt(null)}>
            <DialogContent className="sm:max-w-md animate-in fade-in-0 duration-200">
              <DialogHeader>
                <DialogTitle>Edit Prompt</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={editingPrompt.name}
                    onChange={(e) =>
                      setEditingPrompt({ ...editingPrompt, name: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Prompt</Label>
                  <Textarea
                    value={editingPrompt.prompt}
                    onChange={(e) =>
                      setEditingPrompt({ ...editingPrompt, prompt: e.target.value })
                    }
                    rows={6}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingPrompt(null)}>
                  Cancel
                </Button>
                <Button onClick={handleUpdatePrompt} disabled={loading}>
                  Save Changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* New Prompt Modal */}
        {showNewPromptForm && (
          <Dialog open={showNewPromptForm} onOpenChange={setShowNewPromptForm}>
            <DialogContent className="sm:max-w-md animate-in fade-in-0 duration-200">
              <DialogHeader>
                <DialogTitle>Add New Prompt</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={newPromptName}
                    onChange={(e) => setNewPromptName(e.target.value)}
                    placeholder="e.g., Creative Writer"
                  />
                </div>
                <div>
                  <Label>Prompt</Label>
                  <Textarea
                    value={newPromptContent}
                    onChange={(e) => setNewPromptContent(e.target.value)}
                    placeholder="You are a creative writing assistant..."
                    rows={6}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowNewPromptForm(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreatePrompt}
                  disabled={loading || !newPromptName.trim() || !newPromptContent.trim()}
                >
                  Create Prompt
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
