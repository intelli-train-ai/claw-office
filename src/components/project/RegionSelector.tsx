"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RegionSelectorProps {
  /** The container element to constrain selection within */
  containerRef: React.RefObject<HTMLElement | null>;
  onSelect: (rect: SelectionRect, screenRect: DOMRect) => void;
  onCancel: () => void;
  active: boolean;
}

export function RegionSelector({ containerRef, onSelect, onCancel, active }: RegionSelectorProps) {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const getRelativePos = useCallback((e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, [containerRef]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setStart(getRelativePos(e));
    setCurrent(getRelativePos(e));
  }, [getRelativePos]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!start) return;
    e.preventDefault();
    setCurrent(getRelativePos(e));
  }, [start, getRelativePos]);

  const handleMouseUp = useCallback(() => {
    if (!start || !current) return;

    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);

    // Minimum selection size: 20x20
    if (width < 20 || height < 20) {
      setStart(null);
      setCurrent(null);
      return;
    }

    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    // Screen-absolute rect for Electron capturePage
    const screenRect = new DOMRect(
      containerRect.left + x,
      containerRect.top + y,
      width,
      height,
    );

    onSelect({ x, y, width, height }, screenRect);
    setStart(null);
    setCurrent(null);
  }, [start, current, containerRef, onSelect]);

  // Escape to cancel
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStart(null);
        setCurrent(null);
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onCancel]);

  if (!active) return null;

  // Calculate selection box
  const selectionStyle = start && current ? {
    left: Math.min(start.x, current.x),
    top: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  } : null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-50 cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Dim overlay */}
      <div className="absolute inset-0 bg-black/10" />

      {/* Selection rectangle */}
      {selectionStyle && selectionStyle.width > 0 && selectionStyle.height > 0 && (
        <div
          className="absolute border-2 border-primary bg-primary/10 rounded-sm"
          style={selectionStyle}
        />
      )}
    </div>
  );
}
