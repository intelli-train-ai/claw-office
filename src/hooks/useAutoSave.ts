"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface UseAutoSaveOptions {
  /** Debounce delay in ms (default: 1500) */
  delay?: number;
  /** Callback after successful save */
  onSaved?: () => void;
}

/**
 * Hook for auto-saving file content with debounce.
 *
 * Returns:
 * - `content`: current editor content
 * - `setContent`: update content (triggers debounced save)
 * - `saveStatus`: "idle" | "saving" | "saved" | "error"
 * - `isDirty`: whether content has unsaved changes
 * - `saveNow`: force immediate save
 * - `reset`: reset with new content (e.g. when switching files)
 */
export function useAutoSave(
  filePath: string | null,
  baseDir: string,
  initialContent: string,
  options: UseAutoSaveOptions = {}
) {
  const { delay = 1500, onSaved } = options;

  const [content, setContentRaw] = useState(initialContent);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef(initialContent);
  const savedContentRef = useRef(initialContent);
  const mountedRef = useRef(false);

  // Use ref for onSaved to avoid recreating doSave on every render
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const doSave = useCallback(async (text: string) => {
    if (!filePath || !mountedRef.current) return;
    // Skip save if content hasn't actually changed from last saved version
    if (text === savedContentRef.current) {
      if (mountedRef.current) {
        setIsDirty(false);
        setSaveStatus("saved");
        setTimeout(() => { if (mountedRef.current) setSaveStatus("idle"); }, 2000);
      }
      return;
    }
    if (mountedRef.current) setSaveStatus("saving");
    try {
      const res = await fetch("/api/files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, baseDir, content: text }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Save failed");
      }
      if (mountedRef.current) {
        savedContentRef.current = text;
        setIsDirty(latestContentRef.current !== text);
        setSaveStatus("saved");
        onSavedRef.current?.();
        setTimeout(() => { if (mountedRef.current) setSaveStatus("idle"); }, 2000);
      }
    } catch {
      if (mountedRef.current) setSaveStatus("error");
    }
  }, [filePath, baseDir]);

  const setContent = useCallback((text: string) => {
    setContentRaw(text);
    latestContentRef.current = text;
    setIsDirty(text !== savedContentRef.current);
    setSaveStatus((prev) => prev === "error" ? "idle" : prev);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSave(text), delay);
  }, [delay, doSave]);

  const saveNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    doSave(latestContentRef.current);
  }, [doSave]);

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        // Fire-and-forget save on unmount
        if (latestContentRef.current !== savedContentRef.current && filePath) {
          fetch("/api/files", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filePath, baseDir, content: latestContentRef.current }),
          }).catch(() => {});
        }
      }
    };
  }, [filePath, baseDir]);

  const reset = useCallback((newContent: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setContentRaw(newContent);
    latestContentRef.current = newContent;
    savedContentRef.current = newContent;
    setIsDirty(false);
    setSaveStatus("idle");
  }, []);

  return { content, setContent, saveStatus, isDirty, saveNow, reset };
}
