'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import type { Message } from '@/types';
import { MessageItem } from '@/components/chat/MessageItem';
import { CodePilotLogo } from '@/components/chat/CodePilotLogo';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { File, X, SpinnerGap, Copy, Check } from '@/components/ui/icon';
import { useTranslation } from '@/hooks/useTranslation';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { useTheme } from 'next-themes';
import { useThemeFamily } from '@/lib/theme/context';
import { resolveCodeTheme, resolveHljsStyle } from '@/lib/theme/code-themes';
import type { FilePreview } from '@/types';

type ReplayState = 'replaying' | 'completed';

interface SessionMeta {
  title?: string;
  model?: string;
  created_at?: string;
  working_directory?: string;
}

// ── Tool-call file extraction ──────────────────────────────────────────────

interface ToolBlock {
  type: 'tool_use' | 'tool_result';
  name?: string;
  input?: unknown;
}

const READ_TOOLS = new Set(['read', 'readfile', 'read_file']);
const WRITE_TOOLS = new Set(['write', 'edit', 'writefile', 'write_file', 'create_file', 'createfile', 'notebookedit', 'notebook_edit']);

function parseToolBlocksLite(content: string): ToolBlock[] {
  if (!content.startsWith('[')) return [];
  try {
    const blocks = JSON.parse(content) as Array<Record<string, unknown>>;
    return blocks
      .filter(b => b.type === 'tool_use')
      .map(b => ({ type: 'tool_use' as const, name: b.name as string, input: b.input }));
  } catch {
    return [];
  }
}

function getFilePath(input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return '';
  return (inp.file_path || inp.path || inp.filePath || '') as string;
}

interface FileEntry {
  path: string;
  shortName: string;
  action: 'read' | 'write';
}

function extractFilesFromMessages(messages: Message[]): FileEntry[] {
  const seen = new Map<string, FileEntry>();
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const tools = parseToolBlocksLite(msg.content);
    for (const tool of tools) {
      const lower = (tool.name || '').toLowerCase();
      const path = getFilePath(tool.input);
      if (!path) continue;
      let action: 'read' | 'write' | null = null;
      if (READ_TOOLS.has(lower)) action = 'read';
      else if (WRITE_TOOLS.has(lower)) action = 'write';
      if (!action) continue;

      const existing = seen.get(path);
      // Upgrade read → write if later written
      if (!existing || (existing.action === 'read' && action === 'write')) {
        const parts = path.split('/');
        seen.set(path, { path, shortName: parts[parts.length - 1] || path, action });
      }
    }
  }
  return Array.from(seen.values());
}

// ── Inline file preview ────────────────────────────────────────────────────

function ShareFilePreview({ filePath, workingDirectory, onClose }: {
  filePath: string;
  workingDirectory: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const { family, families } = useThemeFamily();
  const isDark = resolvedTheme === 'dark';
  const hljsStyle = resolveHljsStyle(resolveCodeTheme(families, family), isDark);

  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
     
    setError(null);
    fetch(`/api/files/preview?path=${encodeURIComponent(filePath)}${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ''}`)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.error || t('filePreview.failedToLoad')))))
      .then(data => { if (!cancelled) setPreview(data.preview); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filePath, workingDirectory, t]);

  const segments = filePath.split('/').filter(Boolean);
  const display = segments.slice(-3);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">
            {display.length < segments.length && '.../'}{display.join('/')}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => {
          navigator.clipboard.writeText(filePath);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}>
          {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>
      {preview && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
          <Badge variant="secondary" className="text-[10px]">{preview.language}</Badge>
          <span className="text-[10px] text-muted-foreground">{preview.line_count} lines</span>
        </div>
      )}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <SpinnerGap size={18} className="animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="px-3 py-6 text-center text-xs text-destructive">{error}</div>
        ) : preview ? (
          <SyntaxHighlighter
            language={preview.language}
            style={hljsStyle}
            showLineNumbers
            customStyle={{ margin: 0, padding: '8px', fontSize: '11px', lineHeight: '1.5', background: 'transparent' }}
            lineNumberStyle={{ minWidth: '2.5em', paddingRight: '8px', color: 'var(--muted-foreground)', opacity: 0.5, userSelect: 'none' }}
          >
            {preview.content}
          </SyntaxHighlighter>
        ) : null}
      </ScrollArea>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

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
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Ref-driven replay: immune to re-renders from file panel clicks etc.
  const replayRef = useRef({ running: false, index: 0, timer: 0 as ReturnType<typeof setTimeout> | 0 });

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

        const s = sessionData.session || sessionData;
        setSessionMeta({
          title: s.title,
          model: s.model,
          created_at: s.created_at,
          working_directory: s.working_directory,
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

  // Extract file list from all messages (frozen snapshot)
  const fileEntries = useMemo(() => extractFilesFromMessages(allMessages), [allMessages]);

  // Start replay once data is loaded — runs entirely via refs, no effect deps on visibleCount
  useEffect(() => {
    if (loading || error || allMessages.length === 0 || replayState !== 'replaying') return;
    if (replayRef.current.running) return;
    replayRef.current.running = true;
    replayRef.current.index = 0;

    function tick() {
      const r = replayRef.current;
      if (!r.running) return;
      r.index++;
      setVisibleCount(r.index);

      if (r.index >= allMessages.length) {
        r.running = false;
        setReplayState('completed');
        return;
      }

      // Scroll smoothly
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }

      // Calculate next delay
      const msg = allMessages[r.index - 1];
      const contentLen = msg.content.length;
      const baseDelay = allMessages.length > 100 ? 100 : allMessages.length > 50 ? 200 : 300;
      const delay = Math.min(baseDelay + Math.min(contentLen / 10, 500), 800);
      r.timer = setTimeout(tick, delay);
    }

    // Kick off first message immediately
    tick();

    const currentReplay = replayRef.current;
    return () => {
      currentReplay.running = false;
      if (currentReplay.timer) clearTimeout(currentReplay.timer);
    };
  }, [loading, error, allMessages, replayState]);

  const handleSkip = useCallback(() => {
    replayRef.current.running = false;
    if (replayRef.current.timer) clearTimeout(replayRef.current.timer);
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
      <header className="flex items-center justify-between border-b border-border px-6 py-3 shrink-0">
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
              {fileEntries.length > 0 && <span>· {fileEntries.length} files</span>}
            </div>
          </div>
        </div>
        {replayState === 'replaying' && (
          <Button variant="outline" size="sm" onClick={handleSkip}>
            {t('share.skipReplay')}
          </Button>
        )}
      </header>

      {/* Body: messages + file panel */}
      <div className="flex flex-1 min-h-0">
        {/* Messages */}
        <main
          ref={scrollRef}
          className="flex-1 overflow-y-auto scroll-smooth"
        >
          <div className="mx-auto max-w-3xl flex flex-col gap-6 p-4 pb-16">
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

        {/* Right: file panel */}
        {fileEntries.length > 0 && (
          <aside className="w-72 shrink-0 border-l border-border flex flex-col bg-muted/30">
            {selectedFile ? (
              <ShareFilePreview
                filePath={selectedFile}
                workingDirectory={sessionMeta?.working_directory || ''}
                onClose={() => setSelectedFile(null)}
              />
            ) : (
              <>
                <div className="px-3 py-2.5 border-b border-border">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {t('panel.files')}
                  </h2>
                </div>
                <ScrollArea className="flex-1">
                  <div className="py-1">
                    {fileEntries.map(entry => (
                      <button
                        key={entry.path}
                        onClick={() => setSelectedFile(entry.path)}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-muted/60 transition-colors group"
                      >
                        <File size={14} className={entry.action === 'write' ? 'text-amber-500 shrink-0' : 'text-muted-foreground shrink-0'} />
                        <span className="text-xs truncate flex-1 group-hover:text-foreground text-foreground/80">
                          {entry.shortName}
                        </span>
                        {entry.action === 'write' && (
                          <span className="text-[10px] text-amber-500 shrink-0">edited</span>
                        )}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </aside>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-2 text-center text-xs text-muted-foreground shrink-0">
        {t('share.generatedBy')}
      </footer>
    </div>
  );
}
