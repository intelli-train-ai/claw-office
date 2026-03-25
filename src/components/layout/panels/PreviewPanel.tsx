"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTheme } from "next-themes";
import { X, Copy, Check, SpinnerGap } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import { useThemeFamily } from "@/lib/theme/context";
import { resolveCodeTheme, resolveHljsStyle } from "@/lib/theme/code-themes";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import type { FilePreview as FilePreviewType } from "@/types";

const streamdownPlugins = { cjk, code, math, mermaid };

type ViewMode = "source" | "rendered";

/** Extensions that support a rendered preview */
const RENDERABLE_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm"]);

/** Image extensions */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg", ".avif"]);

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

function isImage(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filePath));
}

function isPdf(filePath: string): boolean {
  return PDF_EXTENSIONS.has(getExtension(filePath));
}

function isOffice(filePath: string): boolean {
  return OFFICE_EXTENSIONS.has(getExtension(filePath));
}

function isHtml(filePath: string): boolean {
  const ext = getExtension(filePath);
  return ext === ".html" || ext === ".htm";
}

const PREVIEW_MIN_WIDTH = 320;
const PREVIEW_MAX_WIDTH = 800;
const PREVIEW_DEFAULT_WIDTH = 480;

export function PreviewPanel() {
  const { resolvedTheme } = useTheme();
  const { workingDirectory, previewFile, setPreviewFile, previewViewMode, setPreviewViewMode, setPreviewOpen } = usePanel();
  const isDark = resolvedTheme === "dark";
  const [preview, setPreview] = useState<FilePreviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(PREVIEW_DEFAULT_WIDTH);

  const handleResize = useCallback((delta: number) => {
    // Left-side handle: dragging left (negative delta) = wider
    setWidth((w) => Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, w - delta)));
  }, []);

  const filePath = previewFile || "";
  const imageFile = isImage(filePath);
  const pdfFile = isPdf(filePath);
  const officeFile = isOffice(filePath);
  const [officeHtml, setOfficeHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath || imageFile || pdfFile) return;

    // Office files use a separate endpoint
    if (officeFile) {
      let cancelled = false;
      setLoading(true);
      setError(null);
      setOfficeHtml(null);

      (async () => {
        try {
          const res = await fetch(
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
        const res = await fetch(
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

  return (
    <div className="flex h-full shrink-0 overflow-hidden">
      <ResizeHandle side="left" onResize={handleResize} />
      <div className="flex h-full flex-1 flex-col overflow-hidden border-r border-border/40 bg-background" style={{ width }}>
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{fileName}</p>
        </div>

        {!imageFile && !pdfFile && !officeFile && canRender && (
          <ViewModeToggle value={previewViewMode} onChange={setPreviewViewMode} />
        )}

        {!imageFile && !pdfFile && !officeFile && (
          <Button variant="ghost" size="icon-sm" onClick={handleCopyContent}>
            {copied ? (
              <Check size={14} className="text-status-success-foreground" />
            ) : (
              <Copy size={14} />
            )}
            <span className="sr-only">Copy content</span>
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
        {imageFile || pdfFile || officeFile ? (
          <span className="shrink-0 text-[10px] text-muted-foreground/50">
            {getExtension(filePath).slice(1)}
          </span>
        ) : preview ? (
          <span className="shrink-0 text-[10px] text-muted-foreground/50">
            {preview.language}
          </span>
        ) : null}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {imageFile ? (
          <ImageView filePath={filePath} />
        ) : pdfFile ? (
          <PdfView filePath={filePath} />
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
        ) : preview ? (
          previewViewMode === "rendered" && canRender ? (
            <RenderedView content={preview.content} filePath={filePath} workingDirectory={workingDirectory} />
          ) : (
            <SourceView preview={preview} isDark={isDark} />
          )
        ) : null}
      </div>
      </div>
    </div>
  );
}

/** Capsule toggle for Source / Preview view mode */
function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
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

/** Image preview view */
function ImageView({ filePath }: { filePath: string }) {
  const src = `/api/files/raw?path=${encodeURIComponent(filePath)}`;
  const fileName = filePath.split("/").pop() || filePath;

  return (
    <div className="flex h-full items-center justify-center p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={fileName}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

/** PDF preview via native browser rendering */
function PdfView({ filePath }: { filePath: string }) {
  const src = `/api/files/raw?path=${encodeURIComponent(filePath)}`;
  return (
    <iframe
      src={src}
      className="h-full w-full border-0"
      title="PDF Preview"
    />
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

  // Markdown / MDX — strip YAML frontmatter before rendering
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  // Resolve relative image paths to API URLs so they render correctly
  const resolved = resolveMarkdownImages(body, filePath, workingDirectory);
  return (
    <div className="px-6 py-4 overflow-x-hidden break-words">
      <Streamdown
        className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:pl-6 [&_ol]:pl-6"
        plugins={streamdownPlugins}
      >
        {resolved}
      </Streamdown>
    </div>
  );
}
