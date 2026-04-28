'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Message, MessagesResponse, FileAttachment, SessionStreamSnapshot } from '@/types';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { ChatComposerActionBar } from './ChatComposerActionBar';
import { ModeIndicator } from './ModeIndicator';
import { ChatPermissionSelector } from './ChatPermissionSelector';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import { FolderPicker } from './FolderPicker';
import { Button } from '@/components/ui/button';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import { PermissionPrompt } from './PermissionPrompt';
import { useChatCommands } from '@/hooks/useChatCommands';
import { useAssistantTrigger } from '@/hooks/useAssistantTrigger';
import { useStreamSubscription } from '@/hooks/useStreamSubscription';
import {
  startStream,
  stopStream,
  getSnapshot,
  getRewindPoints,
  respondToPermission,
} from '@/lib/stream-session-manager';
import { authFetch } from '@/lib/api-client';

interface ChatViewProps {
  sessionId: string;
  initialMessages?: Message[];
  initialHasMore?: boolean;
  modelName?: string;
  providerId?: string;
  initialPermissionProfile?: 'default' | 'full_access';
  initialMode?: 'code' | 'plan';
  initialHasSummary?: boolean;
}

/** Maximum messages kept in React state. Older messages are trimmed and reloaded on scroll. */
const MAX_MESSAGES_IN_MEMORY = 300;

export function ChatView({ sessionId, initialMessages = [], initialHasMore = false, modelName, providerId, initialPermissionProfile, initialMode, initialHasSummary }: ChatViewProps) {
  const { setStreamingSessionId, workingDirectory, setPendingApprovalSessionId, setDashboardPanelOpen, setFileTreeOpen, setIsAssistantWorkspace } = usePanel();
  const { t } = useTranslation();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [permissionProfile, setPermissionProfile] = useState<'default' | 'full_access'>(initialPermissionProfile || 'default');

  // Whether this session's working directory matches the configured assistant workspace
  const [isAssistantProject, setIsAssistantProject] = useState(false);
  const [assistantName, setAssistantName] = useState('');

  // Workspace mismatch banner state
  const [workspaceMismatchPath, setWorkspaceMismatchPath] = useState<string | null>(null);
  // Assistant mode: cwd IS workspace, can attach a project directory as add-dir
  const [cwdIsWorkspace, setCwdIsWorkspace] = useState(false);
  const [attachedProjectDir, setAttachedProjectDir] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  // Project mode: toggle to attach/detach assistant workspace as add-dir
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [assistantWorkspacePath, setAssistantWorkspacePath] = useState<string | null>(null);
  const [assistantConfigured, setAssistantConfigured] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  /** Tracks whether the tail (newest messages) was trimmed during a prepend. */
  const tailTrimmedRef = useRef(false);

  /**
   * Capped message setter for append paths (user send, stream completion, commands).
   *
   * - Normal case: trims head (oldest) when exceeding cap, sets hasMore = true.
   * - If tail was previously trimmed by a prepend (user scrolled far up): re-fetches
   *   the latest messages from DB as a fresh base, then applies the append on top.
   *   This slides the window back to the bottom without losing the new message.
   */
  /**
   * Reconcile the message window with DB after tail was trimmed.
   * Preserves local-only cmd-* messages (/help, /cost) since they're never persisted.
   * Called with a delay to ensure pending persists have completed.
   */
  const reconcileWithDb = useCallback(() => {
    fetch(`/api/chat/sessions/${sessionId}/messages?limit=50`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data?.messages) return;
        setHasMore(data.hasMore ?? true);
        const dbMessages: Message[] = data.messages;
        setMessages(current => {
          const localCommands = current.filter(m => m.id.startsWith('cmd-'));
          if (localCommands.length === 0) return dbMessages;
          const merged = [...dbMessages, ...localCommands];
          return merged.length > MAX_MESSAGES_IN_MEMORY
            ? merged.slice(-MAX_MESSAGES_IN_MEMORY)
            : merged;
        });
      })
      .catch(() => { /* keep current state as-is */ });
  }, [sessionId]);

  const cappedSetMessages: typeof setMessages = useCallback((action) => {
    setMessages((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      if (next.length > MAX_MESSAGES_IN_MEMORY) {
        setHasMore(true);
        return next.slice(-MAX_MESSAGES_IN_MEMORY);
      }
      return next;
    });
  }, []);
  const [mode, setMode] = useState<string>(initialMode || 'code');
  const [currentModel, setCurrentModel] = useState(() => modelName || (typeof window !== 'undefined' ? localStorage.getItem('safeclaw:last-model') : null) || 'sonnet');
  const [currentProviderId, setCurrentProviderId] = useState(() => providerId || (typeof window !== 'undefined' ? localStorage.getItem('safeclaw:last-provider-id') : null) || '');
  const [selectedEffort, setSelectedEffort] = useState<string | undefined>(undefined);
  const [thinkingMode, setThinkingMode] = useState<string>('adaptive');
  const [context1m, setContext1m] = useState(false);
  const [hasSummary, setHasSummary] = useState(initialHasSummary || false);

  // Sync model/provider when session data loads
  useEffect(() => { if (modelName) setCurrentModel(modelName); }, [modelName]);
  useEffect(() => { if (providerId) setCurrentProviderId(providerId); }, [providerId]);

  // Fetch provider-specific options (with abort to prevent stale responses on fast switch)
  useEffect(() => {
    const pid = currentProviderId || 'env';
    const controller = new AbortController();
    authFetch(`/api/providers/options?providerId=${encodeURIComponent(pid)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!controller.signal.aborted) {
          setThinkingMode(data?.options?.thinking_mode || 'adaptive');
          setContext1m(!!data?.options?.context_1m);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [currentProviderId]);
  useEffect(() => { if (initialPermissionProfile) setPermissionProfile(initialPermissionProfile); }, [initialPermissionProfile]);

  // Stream snapshot from the manager — drives all streaming UI
  const [streamSnapshot, setStreamSnapshot] = useState<SessionStreamSnapshot | null>(
    () => getSnapshot(sessionId)
  );

  // Derive rendering state from snapshot
  const isStreaming = streamSnapshot?.phase === 'active';
  const streamingContent = streamSnapshot?.streamingContent ?? '';
  const toolUses = streamSnapshot?.toolUses ?? [];
  const toolResults = streamSnapshot?.toolResults ?? [];
  const streamingToolOutput = streamSnapshot?.streamingToolOutput ?? '';
  const streamingThinkingContent = streamSnapshot?.streamingThinkingContent ?? '';
  const statusText = streamSnapshot?.statusText;
  const pendingPermission = streamSnapshot?.pendingPermission ?? null;
  const permissionResolved = streamSnapshot?.permissionResolved ?? null;
  const rewindPoints = getRewindPoints(sessionId);

  // Pending image generation notices
  const pendingImageNoticesRef = useRef<string[]>([]);
  const sendMessageRef = useRef<(content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string) => Promise<void>>(undefined);
  const initMetaRef = useRef<{ tools?: unknown; slash_commands?: unknown; skills?: unknown } | null>(null);

  const handleModeChange = useCallback((newMode: string) => {
    setMode(newMode);
    if (sessionId) {
      authFetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      }).then(() => {
        window.dispatchEvent(new CustomEvent('session-updated'));
      }).catch(() => { /* silent */ });

      authFetch('/api/chat/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, mode: newMode }),
      }).catch(() => { /* silent */ });
    }
  }, [sessionId]);

  const handleProviderModelChange = useCallback((newProviderId: string, model: string) => {
    setCurrentProviderId(newProviderId);
    setCurrentModel(model);
    authFetch(`/api/chat/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, provider_id: newProviderId }),
    }).catch(() => {});
  }, [sessionId]);

  // ── Extracted hooks ──

  const handleStreamCompleted = useCallback((phase: string) => {
    // Only reconcile on normal completion — both messages are persisted.
    // Error/stopped/idle-timeout paths emit 'completed' before the server
    // has persisted partial output, so reconciliation would race.
    if (tailTrimmedRef.current && phase === 'completed') {
      tailTrimmedRef.current = false;
      reconcileWithDb();
    }
  }, [reconcileWithDb]);

  useStreamSubscription({
    sessionId,
    setStreamSnapshot,
    setStreamingSessionId,
    setPendingApprovalSessionId,
    setMessages: cappedSetMessages,
    onStreamCompleted: handleStreamCompleted,
  });

  const initializedRef = useRef(false);
  useEffect(() => {
    if (initialMessages.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  useEffect(() => { setHasMore(initialHasMore); }, [initialHasMore]);

  // Detect compression from multiple sources:
  // 1. Auto-compression: stream-session-manager dispatches 'context-compressed' event
  // 2. Manual /compact: response message contains the compression marker
  useEffect(() => {
    if (!hasSummary && messages.some(m => m.role === 'assistant' && m.content.includes('上下文已压缩'))) {
      setHasSummary(true);
    }
  }, [messages, hasSummary]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId === sessionId) {
        setHasSummary(true);
      }
    };
    window.addEventListener('context-compressed', handler);
    return () => window.removeEventListener('context-compressed', handler);
  }, [sessionId]);

  const buildThinkingConfig = useCallback((): { type: string } | undefined => {
    if (!thinkingMode || thinkingMode === 'adaptive') return { type: 'adaptive' };
    if (thinkingMode === 'enabled') return { type: 'enabled' };
    if (thinkingMode === 'disabled') return { type: 'disabled' };
    return undefined;
  }, [thinkingMode]);

  const checkAssistantTrigger = useAssistantTrigger({
    sessionId,
    workingDirectory,
    isStreaming,
    mode,
    currentModel,
    currentProviderId,
    initialMessages,
    handleModeChange,
    buildThinkingConfig,
    sendMessageRef,
    initMetaRef,
  });

  // Detect workspace mismatch
  useEffect(() => {
    if (!workingDirectory) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/settings/workspace');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        // Track workspace config for assistant toggle
        const wsConfigured = !!data.state?.onboardingComplete;
        setAssistantWorkspacePath(data.path || null);
        setAssistantConfigured(wsConfigured);

        // Check if assistant workspace is accessible: either as cwd or via additional_directories
        let assistantViaAddDir = false;
        if (data.path && workingDirectory !== data.path) {
          // Check if the session has the assistant workspace in additional_directories
          try {
            const sessionRes = await authFetch(`/api/chat/sessions/${sessionId}`);
            if (sessionRes.ok && !cancelled) {
              const sessionData = await sessionRes.json();
              const addDirs: string[] = (() => {
                try { return JSON.parse(sessionData.session?.additional_directories || '[]'); } catch { return []; }
              })();
              assistantViaAddDir = addDirs.includes(data.path);
              setAssistantEnabled(assistantViaAddDir);
            }
          } catch { /* ignore */ }
        }

        if (data.path && workingDirectory !== data.path && !assistantViaAddDir) {
          setIsAssistantProject(false);
          setIsAssistantWorkspace(false);
          const inspectRes = await authFetch(`/api/workspace/inspect?path=${encodeURIComponent(workingDirectory)}`);
          if (!inspectRes.ok || cancelled) return;
          const inspectData = await inspectRes.json();
          if (inspectData.hasAssistantData) {
            setWorkspaceMismatchPath(data.path);
          } else {
            setWorkspaceMismatchPath(null);
          }
        } else {
          // workingDirectory matches assistant workspace path, or workspace is in add-dirs
          const isAssistant = !!data.path;
          setIsAssistantProject(isAssistant);
          setWorkspaceMismatchPath(null);
          setIsAssistantWorkspace(isAssistant);
          setCwdIsWorkspace(workingDirectory === data.path);
          // Load existing attached project dir from session additional_directories
          if (assistantViaAddDir) {
            // In project mode with assistant as add-dir: no attached project dir display needed
          } else if (workingDirectory === data.path) {
            // In assistant mode: check if there's a project dir in add-dirs
            try {
              const sessRes = await authFetch(`/api/chat/sessions/${sessionId}`);
              if (sessRes.ok && !cancelled) {
                const sessData = await sessRes.json();
                const addDirs: string[] = (() => {
                  try { return JSON.parse(sessData.session?.additional_directories || '[]'); } catch { return []; }
                })();
                // Find non-workspace dirs
                const projectDirs = addDirs.filter((d: string) => d !== data.path);
                if (projectDirs.length > 0) {
                  setAttachedProjectDir(projectDirs[0]);
                }
              }
            } catch { /* ignore */ }
          }
          // Default panel is now controlled by the user's "Default Side Panel" setting
          // in chat/[id]/page.tsx — no longer force-override for assistant workspaces.
          // Load assistant name for avatar display
          if (data.path) {
            try {
              const summaryRes = await fetch('/api/workspace/summary');
              if (summaryRes.ok && !cancelled) {
                const summary = await summaryRes.json();
                setAssistantName(summary.name || '');
                // Store buddy emoji globally for MessageItem avatar rendering
                // Store buddy info globally for MessageItem avatar rendering
                (globalThis as Record<string, unknown>).__safeclaw_buddy_info__ = summary.buddy
                  ? { emoji: summary.buddy.emoji, species: summary.buddy.species, rarity: summary.buddy.rarity }
                  : undefined;
              }
            } catch { /* ignore */ }
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [workingDirectory]);

  // Listen for workspace-switched events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.newPath && workingDirectory && workingDirectory === detail.oldPath) {
        setWorkspaceMismatchPath(detail.newPath);
      }
    };
    window.addEventListener('assistant-workspace-switched', handler);
    return () => window.removeEventListener('assistant-workspace-switched', handler);
  }, [workingDirectory]);

  const handleOpenNewAssistant = useCallback(async () => {
    try {
      const model = typeof window !== 'undefined' ? localStorage.getItem('safeclaw:last-model') || '' : '';
      const provider_id = typeof window !== 'undefined' ? localStorage.getItem('safeclaw:last-provider-id') || '' : '';
      const res = await authFetch('/api/workspace/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'checkin', model, provider_id }),
      });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent('session-created'));
        router.push(`/chat/${data.session.id}`);
      }
    } catch (e) {
      console.error('[ChatView] Failed to open assistant session:', e);
    }
  }, [router]);

  const loadEarlierMessages = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || messages.length === 0) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const earliest = messages[0];
      const earliestRowId = (earliest as Message & { _rowid?: number })._rowid;
      if (!earliestRowId) return;
      const res = await authFetch(`/api/chat/sessions/${sessionId}/messages?limit=100&before=${earliestRowId}`);
      if (!res.ok) return;
      const data: MessagesResponse = await res.json();
      setHasMore(data.hasMore ?? false);
      if (data.messages.length > 0) {
        setMessages(prev => {
          const merged = [...data.messages, ...prev];
          if (merged.length > MAX_MESSAGES_IN_MEMORY) {
            // Trim newest messages off the tail — they'll be restored when
            // the next append triggers cappedSetMessages (re-fetches from DB).
            tailTrimmedRef.current = true;
            return merged.slice(0, MAX_MESSAGES_IN_MEMORY);
          }
          return merged;
        });
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [sessionId, messages, hasMore]);

  const stopStreaming = useCallback(() => { stopStream(sessionId); }, [sessionId]);

  const handlePermissionResponse = useCallback(
    async (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>, denyMessage?: string) => {
      setPendingApprovalSessionId('');
      await respondToPermission(sessionId, decision, updatedInput, denyMessage);
    },
    [sessionId, setPendingApprovalSessionId]
  );

  const sendMessage = useCallback(
    async (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string) => {
      if (isStreaming) return;

      const displayUserContent = displayOverride || content;
      let displayContent = displayUserContent;
      if (files && files.length > 0) {
        const fileMeta = files.map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size }));
        displayContent = `<!--files:${JSON.stringify(fileMeta)}-->${displayUserContent}`;
      }

      const userMessage: Message = {
        id: 'temp-' + Date.now(),
        session_id: sessionId,
        role: 'user',
        content: displayContent,
        created_at: new Date().toISOString(),
        token_usage: null,
      };
      cappedSetMessages((prev) => [...prev, userMessage]);

      startStream({
        sessionId,
        content,
        mode,
        model: currentModel,
        providerId: currentProviderId,
        files,
        systemPromptAppend,
        effort: selectedEffort,
        thinking: buildThinkingConfig(),
        context1m,
        displayOverride,
        onModeChanged: (sdkMode) => {
          const uiMode = sdkMode === 'plan' ? 'plan' : 'code';
          handleModeChange(uiMode);
        },
        sendMessageFn: (retryContent: string, retryFiles?: FileAttachment[]) => {
          sendMessageRef.current?.(retryContent, retryFiles);
        },
        onInitMeta: (meta) => {
          initMetaRef.current = meta;
          console.log('[ChatView] SDK init meta received:', meta);
        },
      });

      // If the message window is stale (tailTrimmedRef), reconciliation will
      // happen on stream completion via onStreamCompleted — at that point both
      // user and assistant messages are persisted, so no race is possible.
    },
    [sessionId, isStreaming, mode, currentModel, currentProviderId, selectedEffort, context1m, buildThinkingConfig, handleModeChange]
  );

  sendMessageRef.current = sendMessage;

  // Expose widget drill-down bridge: widgets can call window.__widgetSendMessage(text)
  // to trigger follow-up questions (e.g. clicking a node to get deeper explanation)
  // Hardened: type-checked, length-limited, rate-limited, sanitized.
  useEffect(() => {
    let lastCallTime = 0;
    const RATE_LIMIT_MS = 2000;
    const MAX_LENGTH = 500;

    const bridge = (text: unknown) => {
      if (typeof text !== 'string') return;
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > MAX_LENGTH) return;

      // Rate limit: max one message per 2 seconds
      const now = Date.now();
      if (now - lastCallTime < RATE_LIMIT_MS) return;
      lastCallTime = now;

      sendMessageRef.current?.(trimmed);
    };
    (window as unknown as Record<string, unknown>).__widgetSendMessage = bridge;
    return () => {
      delete (window as unknown as Record<string, unknown>).__widgetSendMessage;
    };
  }, []);

  // Listen for widget pin requests from PinnableWidget buttons.
  // The AI model receives the widget code + instructions and calls the
  // safeclaw_dashboard_pin MCP tool to complete the pin operation.
  useEffect(() => {
    const handler = (e: Event) => {
      const { widgetCode, title } = (e as CustomEvent).detail || {};
      if (!widgetCode || !sendMessageRef.current) return;

      const instruction = `请将下面的可视化组件固定到项目看板。\n\n标题建议：${title || 'Untitled'}\n\n组件代码：\n${widgetCode}`;
      sendMessageRef.current(instruction, undefined, undefined, `📌 固定「${title || 'Widget'}」到看板`);
    };
    window.addEventListener('widget-pin-request', handler);
    return () => window.removeEventListener('widget-pin-request', handler);
  }, []);

  // Listen for dashboard widget drilldown (click title → conversation)
  useEffect(() => {
    const handler = (e: Event) => {
      const { title, dataContract } = (e as CustomEvent).detail || {};
      if (!title || !sendMessageRef.current) return;
      sendMessageRef.current(
        `请深入分析看板组件「${title}」的数据。\n数据契约：${dataContract || '无'}`,
        undefined, undefined,
        `🔍 分析「${title}」`,
      );
    };
    window.addEventListener('dashboard-widget-drilldown', handler);
    return () => window.removeEventListener('dashboard-widget-drilldown', handler);
  }, []);

  // Listen for dashboard command input
  useEffect(() => {
    const handler = (e: Event) => {
      const { text } = (e as CustomEvent).detail || {};
      if (!text || !sendMessageRef.current) return;
      sendMessageRef.current(text, undefined, undefined, text);
    };
    window.addEventListener('dashboard-command', handler);
    return () => window.removeEventListener('dashboard-command', handler);
  }, []);

  const handleCommand = useChatCommands({ sessionId, messages, setMessages: cappedSetMessages, sendMessage });

  // Handler: attach/detach a project directory in assistant mode
  const handleAttachProjectDir = useCallback(async (dirPath: string | null) => {
    try {
      // Build new additional_directories: workspace + optional project dir
      const sessRes = await authFetch(`/api/chat/sessions/${sessionId}`);
      if (!sessRes.ok) return;
      const sessData = await sessRes.json();
      const currentAddDirs: string[] = (() => {
        try { return JSON.parse(sessData.session?.additional_directories || '[]'); } catch { return []; }
      })();

      let newAddDirs: string[];
      if (dirPath) {
        // Add new project dir, keep workspace if present
        const nonProject = currentAddDirs.filter((d: string) => d === workingDirectory);
        newAddDirs = [...nonProject, dirPath];
      } else {
        // Remove project dirs, keep only workspace-related
        newAddDirs = currentAddDirs.filter((d: string) => d === workingDirectory);
      }

      await authFetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ additional_directories: newAddDirs }),
      });
      setAttachedProjectDir(dirPath);
    } catch { /* ignore */ }
  }, [sessionId, workingDirectory]);

  // Handler: toggle assistant workspace as add-dir for project sessions
  const handleToggleAssistant = useCallback(async () => {
    if (!assistantWorkspacePath) return;
    const newEnabled = !assistantEnabled;
    setAssistantEnabled(newEnabled);
    try {
      const sessRes = await authFetch(`/api/chat/sessions/${sessionId}`);
      if (!sessRes.ok) return;
      const sessData = await sessRes.json();
      const currentAddDirs: string[] = (() => {
        try { return JSON.parse(sessData.session?.additional_directories || '[]'); } catch { return []; }
      })();

      let newAddDirs: string[];
      if (newEnabled) {
        newAddDirs = currentAddDirs.includes(assistantWorkspacePath)
          ? currentAddDirs
          : [...currentAddDirs, assistantWorkspacePath];
      } else {
        newAddDirs = currentAddDirs.filter((d: string) => d !== assistantWorkspacePath);
      }

      await authFetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ additional_directories: newAddDirs }),
      });
      setIsAssistantProject(newEnabled);
    } catch {
      setAssistantEnabled(!newEnabled); // rollback on failure
    }
  }, [sessionId, assistantWorkspacePath, assistantEnabled]);

  // Listen for feedback from FilePreview region selector and recording panel
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.content) return;

      // Support pre-built attachments array (from recording) or single screenshot
      let attachments: FileAttachment[] = [];
      if (detail.attachments && Array.isArray(detail.attachments)) {
        attachments = detail.attachments;
      } else if (detail.screenshot) {
        attachments = [{
          id: `feedback-${Date.now()}`,
          name: `${detail.fileName || 'feedback'}.png`,
          type: 'image/png',
          size: Math.round((detail.screenshot as string).length * 0.75),
          data: (detail.screenshot as string).replace(/^data:image\/png;base64,/, ''),
        }];
      }

      sendMessageRef.current?.(detail.content, attachments.length > 0 ? attachments : undefined);
    };
    window.addEventListener('send-feedback-to-chat', handler);
    return () => window.removeEventListener('send-feedback-to-chat', handler);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Workspace mismatch banner */}
      {workspaceMismatchPath && (
        <div className="flex items-center justify-between gap-3 border-b border-status-warning/30 bg-status-warning-muted px-4 py-2">
          <span className="text-xs text-status-warning-foreground">
            {t('assistant.switchedBanner', { path: workspaceMismatchPath })}
          </span>
          <Button
            onClick={handleOpenNewAssistant}
            className="shrink-0 rounded-md bg-status-warning px-3 py-1 text-xs font-medium text-white hover:bg-status-warning/80 transition-colors"
          >
            {t('assistant.openNewAssistant')}
          </Button>
        </div>
      )}
      <MessageList
        messages={messages}
        streamingContent={streamingContent}
        isStreaming={isStreaming}
        toolUses={toolUses}
        toolResults={toolResults}
        streamingToolOutput={streamingToolOutput}
        streamingThinkingContent={streamingThinkingContent}
        statusText={statusText}
        onForceStop={stopStreaming}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadEarlierMessages}
        rewindPoints={rewindPoints}
        sessionId={sessionId}
        isAssistantProject={isAssistantProject}
        assistantName={assistantName}
      />
      {/* Permission prompt */}
      <PermissionPrompt
        pendingPermission={pendingPermission}
        permissionResolved={permissionResolved}
        onPermissionResponse={handlePermissionResponse}
        toolUses={toolUses}
        permissionProfile={permissionProfile}
      />
      <MessageInput
        key={sessionId}
        onSend={sendMessage}
        onCommand={handleCommand}
        onStop={stopStreaming}
        disabled={false}
        isStreaming={isStreaming}
        sessionId={sessionId}
        modelName={currentModel}
        onModelChange={setCurrentModel}
        providerId={currentProviderId}
        onProviderModelChange={handleProviderModelChange}
        workingDirectory={workingDirectory}
        onAssistantTrigger={checkAssistantTrigger}
        effort={selectedEffort}
        onEffortChange={setSelectedEffort}
        sdkInitMeta={initMetaRef.current}
        isAssistantProject={isAssistantProject}
        hasMessages={messages.length > 0}
      />
      <ChatComposerActionBar
        left={<ModeIndicator mode={mode} onModeChange={handleModeChange} disabled={isStreaming} />}
        center={
          <ChatPermissionSelector
            sessionId={sessionId}
            permissionProfile={permissionProfile}
            onPermissionChange={setPermissionProfile}
          />
        }
        right={
          <div className="flex items-center gap-2">
            {!cwdIsWorkspace && assistantConfigured && (
              <button
                type="button"
                onClick={handleToggleAssistant}
                disabled={isStreaming}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                  assistantEnabled
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                    : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                } ${isStreaming ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'}`}
                title={assistantEnabled ? t('chat.assistantToggle.enabled') : t('chat.assistantToggle.disabled')}
              >
                <span className="text-sm">🤖</span>
                <span>{t('chat.assistantToggle.label')}</span>
              </button>
            )}
            {cwdIsWorkspace && (
              attachedProjectDir ? (
                <button
                  type="button"
                  onClick={() => handleAttachProjectDir(null)}
                  className="flex items-center gap-1 rounded-md bg-blue-100 px-2 py-1 text-xs text-blue-700 transition-colors hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                  title={t('chat.projectDir.detach')}
                >
                  <span className="max-w-[120px] truncate">{attachedProjectDir.split('/').pop()}</span>
                  <span className="text-blue-400">×</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setProjectPickerOpen(true)}
                  className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                  title={t('chat.projectDir.attach')}
                >
                  <span>📁</span>
                  <span>{t('chat.projectDir.label')}</span>
                </button>
              )
            )}
            <ContextUsageIndicator
              messages={messages}
              modelName={currentModel}
              context1m={context1m}
              hasSummary={hasSummary}
            />
          </div>
        }
      />
      {projectPickerOpen && (
        <FolderPicker
          open={projectPickerOpen}
          onOpenChange={setProjectPickerOpen}
          onSelect={(path) => {
            setProjectPickerOpen(false);
            handleAttachProjectDir(path);
          }}
        />
      )}
    </div>
  );
}
