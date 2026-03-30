"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, Copy, Check, SpinnerGap, ChatCircleText } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "next-themes";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import { useThemeFamily } from "@/lib/theme/context";
import { resolveCodeTheme, resolveHljsStyle } from "@/lib/theme/code-themes";
import { usePanel } from "@/hooks/usePanel";
import { RegionSelector, type SelectionRect } from "./RegionSelector";
import { FeedbackPopover } from "./FeedbackPopover";

function useFilePreviewCodeTheme() {
  const { resolvedTheme } = useTheme();
  const { family, families } = useThemeFamily();
  const isDark = resolvedTheme === "dark";
  const codeTheme = resolveCodeTheme(families, family);
  return resolveHljsStyle(codeTheme, isDark);
}
import { useTranslation } from "@/hooks/useTranslation";
import type { FilePreview as FilePreviewType } from "@/types";

interface FilePreviewProps {
  filePath: string;
  onBack: () => void;
}

/**
 * Capture a screen region using Electron's capturePage API.
 * Falls back to null in browser (dev mode without Electron).
 */
async function captureScreenRegion(screenRect: DOMRect): Promise<string | null> {
  const api = (window as unknown as { electronAPI?: { capture?: { region: (r: { x: number; y: number; width: number; height: number }) => Promise<string | null> } } }).electronAPI;
  if (api?.capture?.region) {
    return api.capture.region({
      x: screenRect.x,
      y: screenRect.y,
      width: screenRect.width,
      height: screenRect.height,
    });
  }
  // Fallback: use canvas-based capture for non-Electron environments
  return null;
}

/**
 * Estimate line number from Y offset in the syntax highlighter.
 * Assumes consistent line height of ~16.5px (11px font * 1.5 line-height).
 */
function estimateLineRange(
  yOffset: number,
  height: number,
  totalLines: number,
  containerScrollTop: number,
): { start: number; end: number } {
  const LINE_HEIGHT = 16.5;
  const PADDING_TOP = 8;
  const adjustedY = yOffset + containerScrollTop - PADDING_TOP;
  const startLine = Math.max(1, Math.floor(adjustedY / LINE_HEIGHT) + 1);
  const endLine = Math.min(totalLines, Math.ceil((adjustedY + height) / LINE_HEIGHT) + 1);
  return { start: startLine, end: endLine };
}

export function FilePreview({ filePath, onBack }: FilePreviewProps) {
  const { workingDirectory } = usePanel();
  const { t } = useTranslation();
  const hljsStyle = useFilePreviewCodeTheme();
  const [preview, setPreview] = useState<FilePreviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Feedback mode state
  const [feedbackActive, setFeedbackActive] = useState(false);
  const [feedbackData, setFeedbackData] = useState<{
    screenshot: string;
    selectionRect: SelectionRect;
    lineRange?: { start: number; end: number };
  } | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadPreview() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/files/preview?path=${encodeURIComponent(filePath)}${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ''}`
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || t('filePreview.failedToLoad'));
        }
        const data = await res.json();
        setPreview(data.preview);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('filePreview.failedToLoad'));
      } finally {
        setLoading(false);
      }
    }

    loadPreview();
  }, [filePath, t, workingDirectory]);

  const handleCopyPath = async () => {
    await navigator.clipboard.writeText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegionSelect = useCallback(async (rect: SelectionRect, screenRect: DOMRect) => {
    const screenshot = await captureScreenRegion(screenRect);
    if (!screenshot) {
      // Fallback: create a placeholder if capture isn't available
      setFeedbackActive(false);
      return;
    }

    // Estimate line range from selection coordinates
    const scrollTop = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')?.scrollTop ?? 0;
    const lineRange = preview
      ? estimateLineRange(rect.y, rect.height, preview.line_count, scrollTop)
      : undefined;

    setFeedbackData({ screenshot, selectionRect: rect, lineRange });
  }, [preview]);

  const handleFeedbackSend = useCallback((context: string, screenshot: string, fileName: string) => {
    // Dispatch custom event for ChatView to pick up
    window.dispatchEvent(new CustomEvent('send-feedback-to-chat', {
      detail: {
        content: context,
        screenshot,
        fileName,
      },
    }));

    // Reset feedback state
    setFeedbackData(null);
    setFeedbackActive(false);
  }, []);

  const handleFeedbackCancel = useCallback(() => {
    setFeedbackData(null);
    if (!feedbackData) {
      setFeedbackActive(false);
    }
  }, [feedbackData]);

  const toggleFeedbackMode = useCallback(() => {
    if (feedbackActive) {
      setFeedbackActive(false);
      setFeedbackData(null);
    } else {
      setFeedbackActive(true);
    }
  }, [feedbackActive]);

  // Build breadcrumb segments
  const segments = filePath.split("/").filter(Boolean);
  const displaySegments = segments.slice(-3); // show last 3 segments

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ArrowLeft size={14} />
          <span className="sr-only">{t('filePreview.backToTree')}</span>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">
            {displaySegments.length < segments.length && ".../"}{displaySegments.join("/")}
          </p>
        </div>
        <Button
          variant={feedbackActive ? "default" : "ghost"}
          size="icon-sm"
          onClick={toggleFeedbackMode}
          title={t('feedback.toggleTooltip')}
        >
          <ChatCircleText size={14} />
          <span className="sr-only">{t('feedback.toggleTooltip')}</span>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={handleCopyPath}>
          {copied ? (
            <Check size={14} className="text-status-success-foreground" />
          ) : (
            <Copy size={14} />
          )}
          <span className="sr-only">{t('filePreview.copyPath')}</span>
        </Button>
      </div>

      {/* Feedback mode hint */}
      {feedbackActive && !feedbackData && (
        <div className="mb-1 rounded-md bg-primary/10 px-2 py-1 text-[10px] text-primary">
          {t('feedback.selectionHint')}
        </div>
      )}

      {/* File info */}
      {preview && (
        <div className="flex items-center gap-2 pb-2">
          <Badge variant="secondary" className="text-[10px]">
            {preview.language}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {t('filePreview.lines', { count: preview.line_count })}
          </span>
        </div>
      )}

      {/* Content */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <SpinnerGap size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-4 text-center">
            <p className="text-xs text-destructive">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="mt-2 text-xs"
            >
              {t('filePreview.backToTree')}
            </Button>
          </div>
        ) : preview ? (
          <div className="relative rounded-md border border-border text-xs" ref={contentRef}>
            <SyntaxHighlighter
              language={preview.language}
              style={hljsStyle}
              showLineNumbers
              customStyle={{
                margin: 0,
                padding: "8px",
                borderRadius: "6px",
                fontSize: "11px",
                lineHeight: "1.5",
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

            {/* Region selector overlay */}
            <RegionSelector
              containerRef={contentRef}
              active={feedbackActive && !feedbackData}
              onSelect={handleRegionSelect}
              onCancel={() => setFeedbackActive(false)}
            />

            {/* Feedback popover */}
            {feedbackData && (
              <FeedbackPopover
                screenshot={feedbackData.screenshot}
                filePath={filePath}
                lineRange={feedbackData.lineRange}
                anchorRect={feedbackData.selectionRect}
                onSend={handleFeedbackSend}
                onCancel={handleFeedbackCancel}
              />
            )}
          </div>
        ) : null}
      </ScrollArea>
    </div>
  );
}
