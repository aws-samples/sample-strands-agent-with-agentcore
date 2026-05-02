'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useConnector, SkillInfo } from '@/hooks/useConnector';

interface ConnectorPanelProps {
  onBack: () => void;
}

const SOURCE_ORDER: Record<string, number> = {
  builtin: 0,
  gateway: 1,
  mcp: 2,
  a2a: 3,
};

const SOURCE_LABEL: Record<string, string> = {
  builtin: 'Built-in',
  gateway: 'Gateway',
  mcp: 'Connected Apps',
  a2a: 'Agents',
};

const ICON_EXTENSIONS = ['svg', 'png'];

function SkillIcon({ skillName, className }: { skillName: string; className?: string }) {
  const [failed, setFailed] = React.useState(0);
  const src = `/tool-icons/${skillName}.${ICON_EXTENSIONS[failed] || 'svg'}`;

  if (failed >= ICON_EXTENSIONS.length) {
    return <div className={`rounded bg-sidebar-foreground/10 ${className}`} />;
  }

  return (
    <Image
      src={src}
      alt={skillName}
      width={20}
      height={20}
      className={`object-contain ${className || ''}`}
      unoptimized
      onError={() => setFailed(prev => prev + 1)}
    />
  );
}

function groupBySource(skills: SkillInfo[]) {
  const groups: Record<string, SkillInfo[]> = {};
  for (const skill of skills) {
    const key = skill.source || 'builtin';
    if (!groups[key]) groups[key] = [];
    groups[key].push(skill);
  }
  return Object.entries(groups)
    .sort(([a], [b]) => (SOURCE_ORDER[a] ?? 99) - (SOURCE_ORDER[b] ?? 99));
}

export function ConnectorPanel({ onBack }: ConnectorPanelProps) {
  const { allSkills, disabledSkills, isLoading, toggleSkill, saveDisabledSkills } = useConnector();
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const groups = useMemo(() => groupBySource(allSkills), [allSkills]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaved(false);
    try {
      await saveDisabledSkills();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setIsSaving(false);
    }
  }, [saveDisabledSkills]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-3 pb-2">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-2 h-8 px-2 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-[12px]">Chats</span>
          </Button>
          <Button
            variant={saved ? 'ghost' : 'default'}
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className={`h-8 px-3 text-[12px] ${saved ? 'text-green-500' : ''}`}
          >
            {saved ? (
              <>
                <Check className="h-3.5 w-3.5 mr-1" />
                Saved
              </>
            ) : isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="px-4 pb-2 flex-shrink-0">
        <h2 className="text-[14px] font-semibold text-sidebar-foreground">Connectors</h2>
        <p className="text-[11px] text-sidebar-foreground/40 mt-0.5">
          Toggle skills off to exclude from agent
        </p>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="px-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3 pb-4">
            {groups.map(([source, skills]) => (
              <div key={source} className="mb-3">
                <div className="px-2 py-1.5 mb-0.5">
                  <span className="text-[10px] font-medium text-sidebar-foreground/35 uppercase tracking-wider">
                    {SOURCE_LABEL[source] || source}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {skills.map((skill) => {
                    const enabled = !disabledSkills.has(skill.name);
                    return (
                      <div
                        key={skill.name}
                        className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sidebar-accent/40 transition-colors cursor-pointer"
                        onClick={() => toggleSkill(skill.name)}
                      >
                        <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${enabled ? '' : 'opacity-30'}`}>
                          <SkillIcon skillName={skill.name} className="w-[18px] h-[18px]" />
                        </div>
                        <span className={`text-[13px] flex-1 min-w-0 truncate ${enabled ? 'text-sidebar-foreground' : 'text-sidebar-foreground/35'}`}>
                          {skill.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                        </span>
                        <Switch
                          checked={enabled}
                          onCheckedChange={() => {}}
                          className="flex-shrink-0 scale-90 pointer-events-none"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
