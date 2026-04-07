"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Stop, Circle, NotePencil, Image, ArrowRight, Trash } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { RecordedEvent, RecordingSession } from "@/types";

interface RecordingPanelProps {
  recording: boolean;
  session: RecordingSession | null;
  onStop: () => void;
  onDiscard: () => void;
  onAddNote: (text: string) => void;
  onSnapshot: () => void;
  onSend: (summary: string) => void;
}

function formatTs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function eventIcon(type: RecordedEvent["type"]): string {
  switch (type) {
    case "click": return "🖱";
    case "input": return "⌨";
    case "scroll": return "📜";
    case "navigate": return "🔗";
    case "note": return "📝";
    case "snapshot": return "📷";
    default: return "•";
  }
}

function eventLabel(event: RecordedEvent): string {
  switch (event.type) {
    case "click": return `click ${event.target} "${event.text}"`;
    case "input": return `input ${event.target} → "${event.value.slice(0, 40)}"`;
    case "scroll": return `scroll → y=${event.scrollY}`;
    case "navigate": return `navigate → ${event.url}`;
    case "note": return event.text;
    case "snapshot": return "[screenshot]";
    default: return "";
  }
}

export function RecordingPanel({
  recording,
  session,
  onStop,
  onDiscard,
  onAddNote,
  onSnapshot,
  onSend,
}: RecordingPanelProps) {
  const { t } = useTranslation();
  const [noteInput, setNoteInput] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [summary, setSummary] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  // Timer
  useEffect(() => {
    if (!recording || !session) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - session.startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [recording, session]);

  // Auto-scroll timeline
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [session?.events.length]);

  // Focus note input
  useEffect(() => {
    if (showNoteInput) noteRef.current?.focus();
  }, [showNoteInput]);

  const handleNoteSubmit = useCallback(() => {
    const trimmed = noteInput.trim();
    if (trimmed) {
      onAddNote(trimmed);
      setNoteInput("");
      setShowNoteInput(false);
    }
  }, [noteInput, onAddNote]);

  const handleSend = useCallback(() => {
    onSend(summary.trim());
  }, [summary, onSend]);

  if (!session) return null;

  const events = session.events;
  const stopped = !recording;

  return (
    <div className="border-t border-border bg-muted/30">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        {recording ? (
          <Circle size={10} weight="fill" className="text-destructive animate-pulse" />
        ) : (
          <Circle size={10} className="text-muted-foreground" />
        )}
        <span className="text-[11px] font-medium">
          {recording ? t('recording.recording') : t('recording.stopped')}
        </span>
        <span className="text-[11px] text-muted-foreground">{formatTs(elapsed)}</span>
        <span className="text-[10px] text-muted-foreground/60 ml-auto">
          {events.length} {t('recording.events')}
        </span>
      </div>

      {/* Timeline */}
      {events.length > 0 && (
        <div
          ref={timelineRef}
          className="max-h-28 overflow-y-auto px-3 pb-1"
        >
          {events.map((event, i) => (
            <div key={i} className="flex items-start gap-1.5 py-0.5 text-[10px]">
              <span className="shrink-0 text-muted-foreground w-8 text-right">
                {formatTs(event.ts)}
              </span>
              <span className="shrink-0">{eventIcon(event.type)}</span>
              <span className="min-w-0 truncate text-foreground/80">
                {eventLabel(event)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Note input (inline) */}
      {showNoteInput && (
        <div className="flex items-center gap-1 px-3 pb-1">
          <input
            ref={noteRef}
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNoteSubmit();
              if (e.key === "Escape") setShowNoteInput(false);
            }}
            placeholder={t('recording.notePlaceholder')}
            className="flex-1 rounded border border-input bg-transparent px-2 py-0.5 text-[11px] outline-none placeholder:text-muted-foreground focus:border-ring"
          />
          <Button size="sm" onClick={handleNoteSubmit} className="h-5 px-1.5 text-[10px]">
            OK
          </Button>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-t border-border/50">
        {recording ? (
          <>
            <Button variant="ghost" size="sm" onClick={onSnapshot} className="h-6 gap-1 px-2 text-[11px]">
              <Image size={12} />
              {t('recording.snapshot')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowNoteInput(true)} className="h-6 gap-1 px-2 text-[11px]">
              <NotePencil size={12} />
              {t('recording.addNote')}
            </Button>
            <div className="flex-1" />
            <Button variant="destructive" size="sm" onClick={onStop} className="h-6 gap-1 px-2 text-[11px]">
              <Stop size={12} />
              {t('recording.stop')}
            </Button>
          </>
        ) : (
          <>
            {/* Summary input + send */}
            <div className="flex flex-1 items-center gap-1">
              <input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                placeholder={t('recording.summaryPlaceholder')}
                className="flex-1 rounded border border-input bg-transparent px-2 py-0.5 text-[11px] outline-none placeholder:text-muted-foreground focus:border-ring"
              />
              <Button size="sm" onClick={handleSend} className="h-6 gap-1 px-2 text-[11px]">
                {t('feedback.send')}
                <ArrowRight size={10} />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={onDiscard} title={t('recording.discard')}>
                <Trash size={12} />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
