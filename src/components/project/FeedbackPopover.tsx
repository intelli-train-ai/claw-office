"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, ArrowRight } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";

interface FeedbackPopoverProps {
  screenshot: string; // data:image/png;base64,...
  filePath: string;
  lineRange?: { start: number; end: number };
  /** Position relative to the selection container */
  anchorRect: { x: number; y: number; width: number; height: number };
  onSend: (text: string, screenshot: string, context: string) => void;
  onCancel: () => void;
}

export function FeedbackPopover({
  screenshot,
  filePath,
  lineRange,
  anchorRect,
  onSend,
  onCancel,
}: FeedbackPopoverProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Escape to cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const fileName = filePath.split("/").pop() || filePath;
    const contextParts = [`📎 ${t('feedback.file')}: ${filePath}`];
    if (lineRange) {
      contextParts.push(`📍 ${t('feedback.lineRange')}: L${lineRange.start}-L${lineRange.end}`);
    }
    contextParts.push("---", trimmed);

    onSend(contextParts.join("\n"), screenshot, fileName);
  }, [text, filePath, lineRange, screenshot, onSend, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Position below the selection anchor
  const top = anchorRect.y + anchorRect.height + 8;
  const left = Math.max(8, anchorRect.x);

  return (
    <div
      ref={popoverRef}
      className="absolute z-[60] w-72 rounded-lg border border-border bg-popover shadow-lg"
      style={{ top, left }}
    >
      {/* Text input */}
      <div className="p-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('feedback.placeholder')}
          className="w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
          rows={2}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 border-t border-border px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" onClick={onCancel}>
          <X size={14} />
          <span className="sr-only">{t('feedback.cancel')}</span>
        </Button>
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!text.trim()}
          className="h-6 gap-1 px-2 text-xs"
        >
          {t('feedback.send')}
          <ArrowRight size={12} />
        </Button>
      </div>
    </div>
  );
}
