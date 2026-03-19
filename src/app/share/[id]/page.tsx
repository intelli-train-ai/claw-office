'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import type { Message } from '@/types';
import { MessageItem } from '@/components/chat/MessageItem';
import { CodePilotLogo } from '@/components/chat/CodePilotLogo';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';

type ReplayState = 'replaying' | 'completed';

interface SessionMeta {
  title?: string;
  model?: string;
  created_at?: string;
}

export default function ShareReplayPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const { t } = useTranslation();

  const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [replayState, setReplayState] = useState<ReplayState>('replaying');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch session data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sessionRes, messagesRes] = await Promise.all([
          fetch(`/api/chat/sessions/${sessionId}`),
          fetch(`/api/chat/sessions/${sessionId}/messages?limit=9999`),
        ]);
        if (cancelled) return;
        if (!sessionRes.ok || !messagesRes.ok) {
          setError(t('share.sessionNotFound'));
          setLoading(false);
          return;
        }
        const sessionData = await sessionRes.json();
        const messagesData = await messagesRes.json();
        if (cancelled) return;

        setSessionMeta({
          title: sessionData.title || sessionData.session?.title,
          model: sessionData.model || sessionData.session?.model,
          created_at: sessionData.created_at || sessionData.session?.created_at,
        });
        const msgs: Message[] = messagesData.messages || [];
        setAllMessages(msgs);
        setLoading(false);

        if (msgs.length === 0) {
          setReplayState('completed');
        }
      } catch {
        if (!cancelled) {
          setError(t('share.sessionNotFound'));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, t]);

  // Replay animation: show messages one by one
  useEffect(() => {
    if (loading || error || replayState !== 'replaying' || allMessages.length === 0) return;

    // Start showing first message
    if (visibleCount === 0) {
      setVisibleCount(1);
      return;
    }

    if (visibleCount >= allMessages.length) {
      setReplayState('completed');
      return;
    }

    // Calculate delay based on content length — shorter for longer conversations
    const msg = allMessages[visibleCount - 1];
    const contentLen = msg.content.length;
    const baseDelay = allMessages.length > 100 ? 100 : allMessages.length > 50 ? 200 : 300;
    const delay = Math.min(baseDelay + Math.min(contentLen / 10, 500), 800);

    replayTimerRef.current = setTimeout(() => {
      setVisibleCount(prev => prev + 1);
    }, delay);

    return () => {
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    };
  }, [loading, error, replayState, allMessages, visibleCount]);

  // Auto-scroll to bottom during replay
  useEffect(() => {
    if (replayState === 'replaying' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleCount, replayState]);

  const handleSkip = useCallback(() => {
    if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    setVisibleCount(allMessages.length);
    setReplayState('completed');
  }, [allMessages.length]);

  const displayMessages = replayState === 'completed'
    ? allMessages
    : allMessages.slice(0, visibleCount);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <CodePilotLogo className="h-16 w-16" />
        <p className="text-lg font-medium">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <CodePilotLogo className="h-8 w-8" />
          <div>
            <h1 className="text-sm font-semibold">
              {sessionMeta?.title
                ? t('share.replayOf', { title: sessionMeta.title })
                : t('share.replayTitle')}
            </h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {sessionMeta?.model && <span>{sessionMeta.model}</span>}
              {sessionMeta?.model && allMessages.length > 0 && <span>·</span>}
              {allMessages.length > 0 && <span>{allMessages.length} messages</span>}
            </div>
          </div>
        </div>
        {replayState === 'replaying' && (
          <Button variant="outline" size="sm" onClick={handleSkip}>
            {t('share.skipReplay')}
          </Button>
        )}
      </header>

      {/* Messages */}
      <main ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl flex flex-col gap-8 p-4">
          {displayMessages.map((msg, i) => (
            <div
              key={msg.id}
              className={replayState === 'replaying' && i === visibleCount - 1
                ? 'animate-in fade-in slide-in-from-bottom-2 duration-300'
                : undefined}
            >
              <MessageItem message={msg} />
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-2 text-center text-xs text-muted-foreground">
        {t('share.generatedBy')}
      </footer>
    </div>
  );
}
