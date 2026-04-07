"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { authFetch } from "@/lib/api-client";
import { useTheme } from "next-themes";
import { X, Copy, Check, SpinnerGap, ChatCircleText, Circle } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import { useThemeFamily } from "@/lib/theme/context";
import { resolveCodeTheme, resolveHljsStyle } from "@/lib/theme/code-themes";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { useAutoSave } from "@/hooks/useAutoSave";
import type { SaveStatus } from "@/hooks/useAutoSave";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { RegionSelector, type SelectionRect } from "@/components/project/RegionSelector";
import { FeedbackPopover } from "@/components/project/FeedbackPopover";
import { RecordingPanel } from "@/components/project/RecordingPanel";
import type { FilePreview as FilePreviewType, RecordedEvent, RecordingSession, FileAttachment } from "@/types";

// Lazy-load Streamdown and plugins — only loaded when rendered markdown is needed
let _StreamdownComponent: typeof import("streamdown").Streamdown | null = null;
let _streamdownPlugins: Record<string, unknown> | null = null;
let _streamdownPromise: Promise<void> | null = null;

function loadStreamdown(): Promise<void> {
  if (_streamdownPromise) return _streamdownPromise;
  _streamdownPromise = Promise.all([
    import("streamdown"),
    import("@streamdown/cjk"),
    import("@streamdown/code"),
    import("@streamdown/math"),
    import("@streamdown/mermaid"),
  ]).then(([sd, cjkMod, codeMod, mathMod, mermaidMod]) => {
    _StreamdownComponent = sd.Streamdown;
    _streamdownPlugins = {
      cjk: cjkMod.cjk,
      code: codeMod.code,
      math: mathMod.math,
      mermaid: mermaidMod.mermaid,
    };
  }).catch((err) => {
    // Reset so next call retries instead of caching the rejected promise
    _streamdownPromise = null;
    throw err;
  });
  return _streamdownPromise;
}

type ViewMode = "source" | "rendered" | "edit";

/** Extensions that support a rendered preview */
const RENDERABLE_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm"]);

/** Media file extensions that get direct preview (no API fetch needed) */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".avif", ".ico"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".flac", ".aac"]);

/** Extensions that support in-app editing */
const EDITABLE_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".text", ".markdown",
  ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".rb", ".rs", ".go", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp",
  ".css", ".scss", ".less", ".html", ".htm", ".xml", ".svg",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
  ".env", ".gitignore", ".dockerignore", ".editorconfig",
  ".csv", ".tsv", ".log", ".sql",
]);

/** PDF extension */
const PDF_EXTENSIONS = new Set([".pdf"]);

/** Office extensions (docx/xlsx/pptx + legacy) */
const OFFICE_EXTENSIONS = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"]);

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
}

function isRenderable(filePath: string): boolean {
  return RENDERABLE_EXTENSIONS.has(getExtension(filePath));
}

function isImagePreview(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filePath));
}

function isVideoPreview(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtension(filePath));
}

function isAudioPreview(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(getExtension(filePath));
}

function isMediaPreview(filePath: string): boolean {
  return isImagePreview(filePath) || isVideoPreview(filePath) || isAudioPreview(filePath);
}

function isImage(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filePath));
}

function isPdf(filePath: string): boolean {
  return PDF_EXTENSIONS.has(getExtension(filePath));
}

function isOffice(filePath: string): boolean {
  return OFFICE_EXTENSIONS.has(getExtension(filePath));
}

/** PPTX/PPT files get converted to PDF for high-fidelity preview */
const PPTX_EXTENSIONS = new Set([".ppt", ".pptx"]);
function isPptx(filePath: string): boolean {
  return PPTX_EXTENSIONS.has(getExtension(filePath));
}

function isHtml(filePath: string): boolean {
  const ext = getExtension(filePath);
  return ext === ".html" || ext === ".htm";
}

function isEditable(filePath: string): boolean {
  return EDITABLE_EXTENSIONS.has(getExtension(filePath));
}

const PREVIEW_MIN_WIDTH = 320;
const PREVIEW_MAX_WIDTH = 800;
const PREVIEW_DEFAULT_WIDTH = 480;

export function PreviewPanel() {
  const { resolvedTheme } = useTheme();
  const { t } = useTranslation();
  const { workingDirectory, sessionId, previewFile, setPreviewFile, previewViewMode, setPreviewViewMode, setPreviewOpen } = usePanel();
  const isDark = resolvedTheme === "dark";
  const [preview, setPreview] = useState<FilePreviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(PREVIEW_DEFAULT_WIDTH);
  /** Full file content for editing (loaded without line limit) */
  const [fullContent, setFullContent] = useState<string | null>(null);

  // Feedback mode
  const [feedbackActive, setFeedbackActive] = useState(false);
  const [feedbackData, setFeedbackData] = useState<{
    screenshot: string;
    selectionRect: SelectionRect;
    lineRange?: { start: number; end: number };
    pageRange?: { start: number; end: number };
  } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Page boundary offsets (cumulative top positions) populated by PdfView */
  const pdfPageOffsetsRef = useRef<number[]>([]);

  // Recording mode (HTML files only)
  const [recordingActive, setRecordingActive] = useState(false);
  const [recordingSession, setRecordingSession] = useState<RecordingSession | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleResize = useCallback((delta: number) => {
    // Left-side handle: dragging left (negative delta) = wider
    setWidth((w) => Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, w - delta)));
  }, []);

  const filePath = previewFile || "";
  const imageFile = isImage(filePath);
  const pptxFile = isPptx(filePath);
  const pdfFile = isPdf(filePath) || pptxFile;
  const officeFile = isOffice(filePath) && !pptxFile;
  const editable = isEditable(filePath);
  const htmlFile = isHtml(filePath);
  const [officeHtml, setOfficeHtml] = useState<string | null>(null);

  // Load full content when entering edit mode
  useEffect(() => {
    if (previewViewMode !== "edit" || !filePath || !editable) {
      setFullContent(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(
          `/api/files/preview?path=${encodeURIComponent(filePath)}&maxLines=100000${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ''}`
        );
        if (!res.ok) throw new Error("Failed to load file for editing");
        const data = await res.json();
        if (!cancelled) setFullContent(data.preview.content);
      } catch {
        if (!cancelled) setFullContent(null);
      }
    })();
    return () => { cancelled = true; };
  }, [filePath, workingDirectory, previewViewMode, editable]);

  // Reset edit mode when switching files
  useEffect(() => {
    if (previewViewMode === "edit") {
      setFullContent(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  useEffect(() => {
    if (!filePath || isMediaPreview(filePath) || imageFile || pdfFile) {
      setLoading(false);
      return;
    }

    // Office files use a separate endpoint
    if (officeFile) {
      let cancelled = false;
      setLoading(true);
      setError(null);
      setOfficeHtml(null);

      (async () => {
        try {
          const res = await authFetch(
            `/api/files/office-preview?path=${encodeURIComponent(filePath)}${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ''}`
          );
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Failed to convert file");
          }
          const data = await res.json();
          if (!cancelled) setOfficeHtml(data.html);
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load file");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => { cancelled = true; };
    }

    // Text-based files
    let cancelled = false;

    async function loadPreview() {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(
          `/api/files/preview?path=${encodeURIComponent(filePath)}&maxLines=500${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ''}`
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to load file");
        }
        const data = await res.json();
        if (!cancelled) {
          setPreview(data.preview);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load file");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [filePath, workingDirectory, imageFile, pdfFile, officeFile]);

  const handleCopyContent = async () => {
    const text = preview?.content || filePath;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setPreviewFile(null);
    setPreviewOpen(false);
  };

  const fileName = filePath.split("/").pop() || filePath;

  const breadcrumb = useMemo(() => {
    const segments = filePath.split("/").filter(Boolean);
    const display = segments.slice(-3);
    const prefix = display.length < segments.length ? ".../" : "";
    return prefix + display.join("/");
  }, [filePath]);

  const canRender = isRenderable(filePath);
  const isMedia = isMediaPreview(filePath);

  // Build direct file serve URL for media files.
  // Use /api/files/raw which accepts an absolute path and works with
  // browser-initiated requests (img/video/audio src) without auth headers.
  const fileServeUrl = filePath
    ? `/api/files/raw?path=${encodeURIComponent(filePath)}`
    : '';

  // Reset feedback state when switching files
  useEffect(() => {
    setFeedbackActive(false);
    setFeedbackData(null);
  }, [filePath]);

  const handleRegionSelect = useCallback(async (rect: SelectionRect, screenRect: DOMRect) => {
    let screenshot: string | null = null;

    // Try Electron capturePage first
    const api = (window as unknown as { electronAPI?: { capture?: { region: (r: { x: number; y: number; width: number; height: number }) => Promise<string | null> } } }).electronAPI;
    if (api?.capture?.region) {
      try {
        screenshot = await api.capture.region({ x: screenRect.x, y: screenRect.y, width: screenRect.width, height: screenRect.height });
      } catch {
        // Fall through to DOM-based capture
      }
    }

    // Fallback: capture from DOM using html-to-image
    if (!screenshot && contentRef.current) {
      try {
        const { toPng } = await import('html-to-image');
        const dataUrl = await toPng(contentRef.current, {
          canvasWidth: contentRef.current.scrollWidth,
          canvasHeight: contentRef.current.scrollHeight,
          pixelRatio: 2,
          filter: (node) => {
            // Exclude the region selector overlay itself
            if (node instanceof HTMLElement && node.classList?.contains('z-50')) return false;
            return true;
          },
        });

        // Crop to the selected region using a canvas
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = dataUrl;
        });
        const canvas = document.createElement('canvas');
        const dpr = 2;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const scrollTop = contentRef.current.scrollTop;
          ctx.drawImage(
            img,
            rect.x * dpr, (rect.y + scrollTop) * dpr,
            rect.width * dpr, rect.height * dpr,
            0, 0,
            rect.width * dpr, rect.height * dpr,
          );
          screenshot = canvas.toDataURL('image/png');
        }
      } catch (err) {
        console.error('[Feedback] DOM capture failed:', err);
      }
    }

    if (!screenshot) {
      console.warn('[Feedback] Screenshot capture failed');
      setFeedbackActive(false);
      return;
    }

    // Estimate line range for code files
    let lineRange: { start: number; end: number } | undefined;
    if (preview && !imageFile && !pdfFile && !officeFile) {
      const LINE_HEIGHT = 16.5;
      const PADDING_TOP = 8;
      const scrollTop = contentRef.current?.scrollTop ?? 0;
      const adjustedY = rect.y + scrollTop - PADDING_TOP;
      const startLine = Math.max(1, Math.floor(adjustedY / LINE_HEIGHT) + 1);
      const endLine = Math.min(preview.line_count, Math.ceil((adjustedY + rect.height) / LINE_HEIGHT) + 1);
      lineRange = { start: startLine, end: endLine };
    }

    // Estimate page range for PDF/PPTX files
    let pageRange: { start: number; end: number } | undefined;
    if (pdfFile && pdfPageOffsetsRef.current.length > 0) {
      const offsets = pdfPageOffsetsRef.current;
      const scrollTop = contentRef.current?.scrollTop ?? 0;
      const selTop = rect.y + scrollTop;
      const selBottom = selTop + rect.height;
      let startPage = 1;
      let endPage = offsets.length;
      for (let i = 0; i < offsets.length; i++) {
        const pageBottom = i + 1 < offsets.length ? offsets[i + 1] : Infinity;
        if (offsets[i] <= selTop && selTop < pageBottom) startPage = i + 1;
        if (offsets[i] <= selBottom && selBottom <= pageBottom) { endPage = i + 1; break; }
      }
      pageRange = { start: startPage, end: endPage };
    }

    setFeedbackData({ screenshot, selectionRect: rect, lineRange, pageRange });
  }, [preview, imageFile, pdfFile, officeFile]);

  const handleFeedbackSend = useCallback((context: string, screenshot: string, fName: string) => {
    window.dispatchEvent(new CustomEvent('send-feedback-to-chat', {
      detail: { content: context, screenshot, fileName: fName },
    }));
    setFeedbackData(null);
    setFeedbackActive(false);
  }, []);

  const handleFeedbackCancel = useCallback(() => {
    setFeedbackData(null);
    if (!feedbackData) setFeedbackActive(false);
  }, [feedbackData]);

  // --- Recording handlers ---

  const startRecording = useCallback(() => {
    setRecordingActive(true);
    setRecordingSession({ filePath, startedAt: Date.now(), events: [] });
  }, [filePath]);

  const stopRecording = useCallback(() => {
    setRecordingActive(false);
  }, []);

  const discardRecording = useCallback(() => {
    setRecordingActive(false);
    setRecordingSession(null);
  }, []);

  const addRecordingNote = useCallback((text: string) => {
    setRecordingSession((prev) => {
      if (!prev) return prev;
      const event: RecordedEvent = { type: 'note', ts: Date.now() - prev.startedAt, text };
      return { ...prev, events: [...prev.events, event] };
    });
  }, []);

  const takeSnapshot = useCallback(async () => {
    if (!contentRef.current) return;
    // Use Electron capture or html-to-image fallback
    const api = (window as unknown as { electronAPI?: { capture?: { region: (r: { x: number; y: number; width: number; height: number }) => Promise<string | null> } } }).electronAPI;
    const box = contentRef.current.getBoundingClientRect();
    let screenshot: string | null = null;
    if (api?.capture?.region) {
      try {
        screenshot = await api.capture.region({ x: box.x, y: box.y, width: box.width, height: box.height });
      } catch { /* fallback */ }
    }
    if (!screenshot) {
      try {
        const { toPng } = await import('html-to-image');
        screenshot = await toPng(contentRef.current, { pixelRatio: 2 });
      } catch { /* skip */ }
    }
    if (!screenshot) return;
    setRecordingSession((prev) => {
      if (!prev) return prev;
      const event: RecordedEvent = { type: 'snapshot', ts: Date.now() - prev.startedAt, screenshot: screenshot! };
      return { ...prev, events: [...prev.events, event] };
    });
  }, []);

  const sendRecording = useCallback((summary: string) => {
    if (!recordingSession) return;

    const events = recordingSession.events;
    const duration = events.length > 0 ? events[events.length - 1].ts : 0;

    // Build structured message
    const lines: string[] = [
      `📎 ${t('feedback.file')}: ${recordingSession.filePath}`,
      `⏱ ${t('recording.duration')}: ${Math.round(duration / 1000)}s`,
      `📋 ${t('recording.interactionSequence')} (${events.filter(e => e.type !== 'snapshot').length} ${t('recording.steps')}):`,
    ];

    let stepNum = 0;
    for (const event of events) {
      if (event.type === 'snapshot') continue;
      stepNum++;
      const ts = `[${Math.floor(event.ts / 1000 / 60)}:${(Math.floor(event.ts / 1000) % 60).toString().padStart(2, '0')}]`;
      switch (event.type) {
        case 'click': lines.push(`  ${stepNum}. ${ts} 🖱 click ${event.target} "${event.text}"`); break;
        case 'input': lines.push(`  ${stepNum}. ${ts} ⌨ input ${event.target} → "${event.value.slice(0, 50)}"`); break;
        case 'scroll': lines.push(`  ${stepNum}. ${ts} 📜 scroll → y=${event.scrollY}`); break;
        case 'navigate': lines.push(`  ${stepNum}. ${ts} 🔗 navigate → ${event.url}`); break;
        case 'note': lines.push(`  ${stepNum}. ${ts} 📝 ${event.text}`); break;
      }
    }

    if (summary) {
      lines.push('---', summary);
    }

    // Collect screenshot attachments (max 5)
    const snapshots = events.filter((e): e is Extract<RecordedEvent, { type: 'snapshot' }> => e.type === 'snapshot').slice(0, 5);
    const attachments: FileAttachment[] = snapshots.map((snap, i) => ({
      id: `recording-snap-${Date.now()}-${i}`,
      name: `recording-${i + 1}.png`,
      type: 'image/png',
      size: Math.round(snap.screenshot.length * 0.75),
      data: snap.screenshot.replace(/^data:image\/png;base64,/, ''),
    }));

    window.dispatchEvent(new CustomEvent('send-feedback-to-chat', {
      detail: {
        content: lines.join('\n'),
        screenshot: attachments.length > 0 ? attachments[0].data : undefined,
        fileName: filePath.split('/').pop() || 'recording',
        attachments,
      },
    }));

    setRecordingActive(false);
    setRecordingSession(null);
  }, [recordingSession, filePath, t]);

  // Listen for recorder events from iframe postMessage
  useEffect(() => {
    if (!recordingActive) return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'recorder-event' || !e.data.event) return;
      const event = e.data.event as RecordedEvent;
      setRecordingSession((prev) => {
        if (!prev) return prev;
        return { ...prev, events: [...prev.events, event] };
      });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [recordingActive]);

  // Reset recording when switching files
  useEffect(() => {
    setRecordingActive(false);
    setRecordingSession(null);
  }, [filePath]);

  return (
    <div className="flex h-full shrink-0 overflow-hidden">
      <ResizeHandle side="left" onResize={handleResize} />
      <div className="flex h-full flex-1 flex-col overflow-hidden border-r border-border/40 bg-background" style={{ width }}>
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{fileName}</p>
        </div>

        {!isMedia && !imageFile && !pdfFile && !officeFile && (canRender || editable) && (
          <ViewModeToggle value={previewViewMode} onChange={setPreviewViewMode} canRender={canRender} canEdit={editable} />
        )}

        {!isMedia && !imageFile && !pdfFile && !officeFile && previewViewMode !== "edit" && (
          <Button variant="ghost" size="icon-sm" onClick={handleCopyContent}>
            {copied ? (
              <Check size={14} className="text-status-success-foreground" />
            ) : (
              <Copy size={14} />
            )}
            <span className="sr-only">Copy content</span>
          </Button>
        )}

        {/* Recording button — HTML files only */}
        {htmlFile && (
          <Button
            variant={recordingActive || recordingSession ? "default" : "ghost"}
            size="icon-sm"
            onClick={() => {
              if (recordingActive) { stopRecording(); }
              else if (recordingSession) { /* already stopped, panel visible */ }
              else { startRecording(); }
            }}
            title={t('recording.toggleTooltip')}
          >
            <Circle size={14} weight={recordingActive ? "fill" : "regular"} className={recordingActive ? "text-destructive" : ""} />
          </Button>
        )}

        {/* Feedback button — non-HTML files */}
        {!htmlFile && (
          <Button
            variant={feedbackActive ? "default" : "ghost"}
            size="icon-sm"
            onClick={() => { setFeedbackActive(!feedbackActive); setFeedbackData(null); }}
            title={t('feedback.toggleTooltip')}
          >
            <ChatCircleText size={14} />
          </Button>
        )}

        <Button variant="ghost" size="icon-sm" onClick={handleClose}>
          <X size={14} />
          <span className="sr-only">Close preview</span>
        </Button>
      </div>

      {/* Breadcrumb + language */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/60">
          {breadcrumb}
        </p>
        {isMedia ? null : imageFile || pdfFile || officeFile ? (
          <span className="shrink-0 text-[10px] text-muted-foreground/50">
            {getExtension(filePath).slice(1)}
          </span>
        ) : preview ? (
          <span className="shrink-0 text-[10px] text-muted-foreground/50">
            {preview.language}
          </span>
        ) : null}
      </div>

      {/* Feedback hint */}
      {feedbackActive && !feedbackData && (
        <div className="mx-3 mb-1 rounded-md bg-primary/10 px-2 py-1 text-[10px] text-primary">
          {t('feedback.selectionHint')}
        </div>
      )}

      {/* Content */}
      <div className="relative flex-1 min-h-0 overflow-auto" ref={contentRef}>
        {isMedia ? (
          <MediaView filePath={filePath} fileServeUrl={fileServeUrl} />
        ) : imageFile ? (
          <ImageView filePath={filePath} />
        ) : pdfFile ? (
          <PdfView
            filePath={filePath}
            fetchUrl={pptxFile ? `/api/files/convert-pdf?path=${encodeURIComponent(filePath)}` : undefined}
            onPageOffsets={(offsets) => { pdfPageOffsetsRef.current = offsets; }}
          />
        ) : officeFile ? (
          loading ? (
            <div className="flex items-center justify-center py-12">
              <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : officeHtml ? (
            <OfficeView html={officeHtml} ext={getExtension(filePath)} isDark={isDark} />
          ) : null
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : previewViewMode === "edit" && editable ? (
          fullContent !== null ? (
            <EditView
              filePath={filePath}
              baseDir={workingDirectory}
              initialContent={fullContent}
              onSaved={() => {
                // Reload preview content after save so switching back shows fresh data
                authFetch(`/api/files/preview?path=${encodeURIComponent(filePath)}&maxLines=500${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ''}`)
                  .then(r => r.json())
                  .then(data => setPreview(data.preview))
                  .catch(() => {});
              }}
            />
          ) : (
            <div className="flex items-center justify-center py-12">
              <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
            </div>
          )
        ) : preview ? (
          previewViewMode === "rendered" && canRender ? (
            htmlFile ? (
              <InteractiveHtmlView
                ref={iframeRef}
                filePath={filePath}
                workingDirectory={workingDirectory}
                recording={recordingActive}
              />
            ) : (
              <RenderedView content={preview.content} filePath={filePath} workingDirectory={workingDirectory} />
            )
          ) : (
            <SourceView preview={preview} isDark={isDark} />
          )
        ) : null}

        {/* Region selector overlay (non-HTML files) */}
        {!htmlFile && (
          <RegionSelector
            containerRef={contentRef}
            active={feedbackActive && !feedbackData}
            onSelect={handleRegionSelect}
            onCancel={() => setFeedbackActive(false)}
          />
        )}

        {/* Selection highlight retained while feedback popover is open */}
        {!htmlFile && feedbackData && (
          <div
            className="pointer-events-none absolute border-2 border-primary bg-primary/10 rounded-sm z-40"
            style={{
              left: feedbackData.selectionRect.x,
              top: feedbackData.selectionRect.y,
              width: feedbackData.selectionRect.width,
              height: feedbackData.selectionRect.height,
            }}
          />
        )}

        {/* Feedback popover (non-HTML files) */}
        {!htmlFile && feedbackData && (
          <FeedbackPopover
            screenshot={feedbackData.screenshot}
            filePath={filePath}
            lineRange={feedbackData.lineRange}
            pageRange={feedbackData.pageRange}
            anchorRect={feedbackData.selectionRect}
            onSend={handleFeedbackSend}
            onCancel={handleFeedbackCancel}
          />
        )}
      </div>

      {/* Recording panel (HTML files) */}
      {htmlFile && recordingSession && (
        <RecordingPanel
          recording={recordingActive}
          session={recordingSession}
          onStop={stopRecording}
          onDiscard={discardRecording}
          onAddNote={addRecordingNote}
          onSnapshot={takeSnapshot}
          onSend={sendRecording}
        />
      )}
      </div>
    </div>
  );
}

/** Capsule toggle for Source / Preview / Edit view mode */
function ViewModeToggle({
  value,
  onChange,
  canRender,
  canEdit,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  canRender: boolean;
  canEdit: boolean;
}) {
  return (
    <div className="flex h-6 items-center rounded-full bg-muted p-0.5 text-[11px]">
      <Button
        variant="ghost"
        size="sm"
        className={`rounded-full px-2 py-0.5 font-medium h-auto ${
          value === "source"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onChange("source")}
      >
        Source
      </Button>
      {canRender && (
        <Button
          variant="ghost"
          size="sm"
          className={`rounded-full px-2 py-0.5 font-medium h-auto ${
            value === "rendered"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onChange("rendered")}
        >
          Preview
        </Button>
      )}
      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          className={`rounded-full px-2 py-0.5 font-medium h-auto ${
            value === "edit"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onChange("edit")}
        >
          Edit
        </Button>
      )}
    </div>
  );
}

/** Resolve hljs style from the current theme family + mode. */
function useDocCodeTheme(isDark: boolean) {
  const { family, families } = useThemeFamily();
  const codeTheme = resolveCodeTheme(families, family);
  return resolveHljsStyle(codeTheme, isDark);
}

/** Source code view using react-syntax-highlighter */
function SourceView({ preview, isDark }: { preview: FilePreviewType; isDark: boolean }) {
  const hljsStyle = useDocCodeTheme(isDark);
  return (
    <div className="text-xs">
      <SyntaxHighlighter
        language={preview.language}
        style={hljsStyle}
        showLineNumbers
        customStyle={{
          margin: 0,
          padding: "8px",
          borderRadius: 0,
          fontSize: "11px",
          lineHeight: "1.5",
          background: "transparent",
        }}
        lineNumberStyle={{
          minWidth: "2.5em",
          paddingRight: "8px",
          color: "var(--muted-foreground)",
          opacity: 0.5,
          userSelect: "none",
        }}
      >
        {preview.content}
      </SyntaxHighlighter>
    </div>
  );
}

/** Direct media preview — images use authFetch + blob, video/audio use direct URL */
function MediaView({ filePath, fileServeUrl }: { filePath: string; fileServeUrl: string }) {
  if (isImagePreview(filePath)) {
    return <ImageView filePath={filePath} />;
  }

  if (isVideoPreview(filePath)) {
    return (
      <div className="flex items-center justify-center p-4 h-full">
        <video
          src={fileServeUrl}
          controls
          preload="metadata"
          className="max-w-full max-h-full rounded"
        />
      </div>
    );
  }

  if (isAudioPreview(filePath)) {
    return (
      <div className="flex items-center justify-center p-8">
        <audio src={fileServeUrl} controls preload="metadata" className="w-full" />
      </div>
    );
  }

  return null;
}

/** Image preview view */
function ImageView({ filePath }: { filePath: string }) {
  const fileName = filePath.split("/").pop() || filePath;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    authFetch(`/api/files/raw?path=${encodeURIComponent(filePath)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (revoked) return;
        setObjectUrl(URL.createObjectURL(blob));
      })
      .catch((err) => {
        if (!revoked) setError(err.message);
      });
    return () => {
      revoked = true;
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [filePath]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-muted-foreground">
        Failed to load image: {error}
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <SpinnerGap className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={objectUrl}
        alt={fileName}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

/** Data for a single rendered PDF page */
interface PdfPageData {
  dataUrl: string;
  width: number;
  height: number;
}

/** PDF preview rendered page-by-page via pdf.js canvases */
function PdfView({
  filePath,
  fetchUrl,
  onPageOffsets,
}: {
  filePath: string;
  fetchUrl?: string;
  onPageOffsets?: (offsets: number[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState<PdfPageData[]>([]);
  const onPageOffsetsRef = useRef(onPageOffsets);
  onPageOffsetsRef.current = onPageOffsets;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const url = fetchUrl || `/api/files/raw?path=${encodeURIComponent(filePath)}`;
        const res = await authFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        if (cancelled) return;

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (cancelled) return;

        const rendered: PdfPageData[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (cancelled) return;

          const baseViewport = page.getViewport({ scale: 1 });
          const scale = 1.5; // render at 1.5x for sharpness, display scaled down via CSS
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
          }
          rendered.push({
            dataUrl: canvas.toDataURL(),
            width: baseViewport.width,
            height: baseViewport.height,
          });
        }

        if (!cancelled) setPages(rendered);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load PDF');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [filePath, fetchUrl]);

  // Report page offsets after pages render in DOM
  useEffect(() => {
    if (pages.length === 0 || !containerRef.current) return;
    const wrappers = containerRef.current.querySelectorAll<HTMLElement>('[data-pdf-page]');
    const offsets = Array.from(wrappers).map((el) => el.offsetTop);
    onPageOffsetsRef.current?.(offsets);
  }, [pages]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-muted-foreground">
        Failed to load PDF: {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full overflow-auto bg-muted/30 p-4">
      {loading && (
        <div className="flex h-full items-center justify-center">
          <SpinnerGap className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {pages.map((page, i) => (
        <div
          key={i}
          data-pdf-page={i + 1}
          className="mx-auto mb-3"
          style={{ width: page.width }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={page.dataUrl}
            alt={`Page ${i + 1}`}
            className="block w-full rounded shadow-md"
            style={{ aspectRatio: `${page.width} / ${page.height}` }}
          />
        </div>
      ))}
    </div>
  );
}

/** Office file preview (docx/xlsx/pptx converted to HTML) */
function OfficeView({ html, ext, isDark }: { html: string; ext: string; isDark: boolean }) {
  const styles = getOfficeStyles(ext, isDark);
  const srcDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${styles}</style>
</head>
<body>${html}</body>
</html>`;

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      className="h-full w-full border-0"
      title="Office Preview"
    />
  );
}

function getOfficeStyles(ext: string, isDark: boolean): string {
  const bg = isDark ? '#1a1a2e' : '#ffffff';
  const fg = isDark ? '#e4e4e7' : '#1a1a2e';
  const mutedFg = isDark ? '#a1a1aa' : '#71717a';
  const border = isDark ? '#27272a' : '#e4e4e7';
  const headerBg = isDark ? '#27272a' : '#f4f4f5';

  const base = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           color: ${fg}; background: ${bg}; padding: 16px; font-size: 13px; line-height: 1.6; }
    img { max-width: 100%; height: auto; }
    a { color: #3b82f6; }
  `;

  if (ext === '.docx' || ext === '.doc') {
    return `${base}
      body { padding: 24px; max-width: 720px; }
      p { margin-bottom: 8px; }
      h1, h2, h3, h4, h5, h6 { margin: 16px 0 8px; font-weight: 600; }
      h1 { font-size: 1.5em; } h2 { font-size: 1.3em; } h3 { font-size: 1.15em; }
      ul, ol { padding-left: 24px; margin-bottom: 8px; }
      table { border-collapse: collapse; width: 100%; margin: 12px 0; }
      th, td { border: 1px solid ${border}; padding: 6px 10px; text-align: left; }
      th { background: ${headerBg}; font-weight: 600; }
    `;
  }

  if (ext === '.xlsx' || ext === '.xls') {
    return `${base}
      .sheet-tab { font-size: 12px; font-weight: 600; color: ${mutedFg}; margin: 12px 0 6px;
                   padding: 4px 8px; background: ${headerBg}; border-radius: 4px; display: inline-block; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 8px; font-size: 12px; }
      th, td { border: 1px solid ${border}; padding: 4px 8px; text-align: left; white-space: nowrap; }
      th { background: ${headerBg}; font-weight: 600; position: sticky; top: 0; }
      tr:nth-child(even) { background: ${isDark ? '#1e1e30' : '#fafafa'}; }
    `;
  }

  if (ext === '.pptx' || ext === '.ppt') {
    return `${base}
      body { padding: 12px; background: ${isDark ? '#0a0a14' : '#e8e8ec'}; }
      .slide-wrapper { margin-bottom: 16px; }
      .slide-number { font-size: 10px; color: ${mutedFg}; margin-bottom: 4px; text-align: center; }
      .slide {
        position: relative;
        width: 100%;
        padding-bottom: 75%; /* 4:3 default aspect ratio */
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,${isDark ? '0.5' : '0.15'});
        overflow: hidden;
      }
      .shape {
        position: absolute;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        padding: 0.5% 0.8%;
        box-sizing: border-box;
        word-wrap: break-word;
        overflow-wrap: break-word;
        font-size: 1.8vw;
      }
      .sp {
        line-height: 1.35;
        margin: 0.1em 0;
        min-height: 0.5em;
      }
      .bullet {
        display: inline-block;
        min-width: 1em;
      }
    `;
  }

  return base;
}

/**
 * Resolve relative image paths in markdown to `/api/files/resolve-image` URLs.
 * The server-side endpoint walks upward from the markdown file's directory
 * toward the working directory to find the actual image file, which handles
 * common documentation layouts where assets live in a parent directory.
 */
function resolveMarkdownImages(markdown: string, mdFilePath: string, workingDirectory: string): string {
  // ![alt](src) or ![alt](src "title")  — skip absolute URLs and data/blob URIs
  return markdown.replace(
    /!\[([^\]]*)\]\((?!https?:\/\/|data:|blob:)([^)"\s]+)([^)]*)\)/g,
    (_match, alt, src, rest) => {
      const apiUrl = `/api/files/resolve-image?src=${encodeURIComponent(src)}&mdFile=${encodeURIComponent(mdFilePath)}&workDir=${encodeURIComponent(workingDirectory)}`;
      return `![${alt}](${apiUrl}${rest})`;
    },
  );
}

/** Save status indicator shown in the editor header */
function SaveStatusIndicator({ status, isDirty }: { status: SaveStatus; isDirty: boolean }) {
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <SpinnerGap size={10} className="animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === "saved" && !isDirty) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-status-success-foreground">
        <Check size={10} />
        Saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="text-[10px] text-destructive">
        Save failed
      </span>
    );
  }
  if (isDirty) {
    return (
      <span className="text-[10px] text-muted-foreground">
        ●
      </span>
    );
  }
  return null;
}

/** In-app text editor with auto-save */
function EditView({
  filePath,
  baseDir,
  initialContent,
  onSaved,
}: {
  filePath: string;
  baseDir: string;
  initialContent: string;
  onSaved?: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { content, setContent, saveStatus, isDirty, saveNow } = useAutoSave(
    filePath,
    baseDir,
    initialContent,
    { onSaved }
  );

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Ctrl/Cmd+S to force save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveNow]);

  // Handle Tab key for indentation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newContent = content.substring(0, start) + "  " + content.substring(end);
      setContent(newContent);
      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [content, setContent]);

  return (
    <div className="flex h-full flex-col">
      {/* Editor status bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/30 px-3 py-1">
        <SaveStatusIndicator status={saveStatus} isDirty={isDirty} />
        <span className="text-[10px] text-muted-foreground/50">
          Ctrl+S
        </span>
      </div>
      {/* Textarea editor */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        className="flex-1 w-full resize-none bg-transparent px-4 py-3 font-mono text-[12px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40 selection:bg-primary/20"
        style={{ tabSize: 2 }}
      />
    </div>
  );
}

/** Rendered view for markdown / HTML files */
function RenderedView({
  content,
  filePath,
  workingDirectory,
}: {
  content: string;
  filePath: string;
  workingDirectory: string;
}) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadStreamdown().then(() => setReady(true)).catch(() => {});
  }, []);

  if (isHtml(filePath)) {
    return (
      <iframe
        srcDoc={content}
        sandbox=""
        className="h-full w-full border-0"
        title={t('docPreview.htmlPreview')}
      />
    );
  }

  // Markdown / MDX — wait for Streamdown to load
  if (!ready || !_StreamdownComponent || !_streamdownPlugins) {
    return (
      <div className="flex items-center justify-center py-12">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const Sd = _StreamdownComponent;
  // Strip YAML frontmatter before rendering
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  // Resolve relative image paths to API URLs so they render correctly
  const resolved = resolveMarkdownImages(body, filePath, workingDirectory);
  return (
    <div className="px-6 py-4 overflow-x-hidden break-words">
      <Sd
        className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:pl-6 [&_ol]:pl-6"
        plugins={_streamdownPlugins}
      >
        {resolved}
      </Sd>
    </div>
  );
}

/** Interactive HTML preview — served via HTTP for full JS/CSS support */
import { forwardRef } from "react";
import { getStoredAuthToken } from "@/components/auth/TokenGate";

const InteractiveHtmlView = forwardRef<
  HTMLIFrameElement,
  { filePath: string; workingDirectory: string; recording: boolean }
>(function InteractiveHtmlView({ filePath, workingDirectory, recording }, ref) {
  const token = getStoredAuthToken();
  const root = workingDirectory || filePath.substring(0, filePath.lastIndexOf("/"));
  // Make path relative to root
  const resolvedRoot = root.endsWith("/") ? root : root + "/";
  const relativePath = filePath.startsWith(resolvedRoot)
    ? filePath.slice(resolvedRoot.length)
    : filePath.split("/").pop() || filePath;

  const params = new URLSearchParams({
    root,
    path: relativePath,
    ...(recording ? { record: "1" } : {}),
    ...(token ? { token } : {}),
  });
  const src = `/api/files/serve?${params.toString()}`;

  return (
    <iframe
      ref={ref}
      src={src}
      sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
      className="h-full w-full border-0"
      title="Interactive HTML Preview"
    />
  );
});
