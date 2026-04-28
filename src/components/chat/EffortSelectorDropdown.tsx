'use client';

import { useRef, useState, useEffect } from 'react';
import { CaretDown } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import {
  CommandList,
  CommandListItem,
  CommandListGroup,
} from '@/components/patterns';

interface EffortSelectorDropdownProps {
  selectedEffort: string;
  onEffortChange: (effort: string) => void;
  supportedEffortLevels?: string[];
}

// Only these levels have i18n translations and match the SDK's official type
// (`'low' | 'medium' | 'high' | 'max'`). Anything else from the SDK
// (e.g. transient or custom provider values like `xh`) is filtered out so we
// don't leak raw i18n keys into the UI.
const KNOWN_EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const;

export function EffortSelectorDropdown({
  selectedEffort,
  onEffortChange,
  supportedEffortLevels,
}: EffortSelectorDropdownProps) {
  const { t } = useTranslation();
  const effortMenuRef = useRef<HTMLDivElement>(null);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);

  const levels = supportedEffortLevels
    ? supportedEffortLevels.filter((l) => (KNOWN_EFFORT_LEVELS as readonly string[]).includes(l))
    : [...KNOWN_EFFORT_LEVELS];

  // Close effort menu on outside click
  useEffect(() => {
    if (!effortMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (effortMenuRef.current && !effortMenuRef.current.contains(e.target as Node)) {
        setEffortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [effortMenuOpen]);

  return (
    <div className="relative" ref={effortMenuRef}>
      <PromptInputButton
        onClick={() => setEffortMenuOpen((prev) => !prev)}
      >
        <span className="text-xs">{t(`messageInput.effort.${selectedEffort}` as TranslationKey)}</span>
        <CaretDown size={10} className={cn("transition-transform duration-200", effortMenuOpen && "rotate-180")} />
      </PromptInputButton>

      {effortMenuOpen && (
        <CommandList className="w-36 mb-1.5 rounded-lg">
          <CommandListGroup label={t('messageInput.effort.label' as TranslationKey)}>
            <div className="py-0.5">
              {levels.map((level) => (
                <CommandListItem
                  key={level}
                  active={selectedEffort === level}
                  onClick={() => {
                    onEffortChange(level);
                    setEffortMenuOpen(false);
                  }}
                  className="justify-between"
                >
                  <span className="text-xs">{t(`messageInput.effort.${level}` as TranslationKey)}</span>
                  {selectedEffort === level && <span className="text-xs">&#10003;</span>}
                </CommandListItem>
              ))}
            </div>
          </CommandListGroup>
        </CommandList>
      )}
    </div>
  );
}
