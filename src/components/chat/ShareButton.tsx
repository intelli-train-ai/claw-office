'use client';

import { useCallback } from 'react';
import { ShareNetwork } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { showToast } from '@/hooks/useToast';

interface ShareButtonProps {
  sessionId: string;
  disabled?: boolean;
}

export function ShareButton({ sessionId, disabled }: ShareButtonProps) {
  const { t } = useTranslation();

  const handleClick = useCallback(async () => {
    const link = `${window.location.origin}/share/${sessionId}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast({ type: 'success', message: t('share.linkCopied') });
    } catch {
      // Fallback: select text in a hidden input
      const input = document.createElement('input');
      input.value = link;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      showToast({ type: 'success', message: t('share.linkCopied') });
    }
  }, [sessionId, t]);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground"
      onClick={handleClick}
      disabled={disabled}
      title={t('share.copyLink')}
    >
      <ShareNetwork size={18} />
    </Button>
  );
}
