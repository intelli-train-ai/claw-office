"use client";

import { useState, useEffect, useCallback, useRef, type DragEvent } from "react";
import { ArrowsClockwise, MagnifyingGlass, FileCode, Code, File, UploadSimple } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { FileTreeNode } from "@/types";
import {
  FileTree as AIFileTree,
  FileTreeFolder,
  FileTreeFile,
} from "@/components/ai-elements/file-tree";
import { useTranslation } from "@/hooks/useTranslation";
import type { ReactNode } from "react";

interface FileTreeProps {
  workingDirectory: string;
  onFileSelect: (path: string) => void;
  onFileAdd?: (path: string) => void;
}

function getFileIcon(extension?: string): ReactNode {
  switch (extension) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "py":
    case "rb":
    case "rs":
    case "go":
    case "java":
    case "c":
    case "cpp":
    case "h":
    case "hpp":
    case "cs":
    case "swift":
    case "kt":
    case "dart":
    case "lua":
    case "php":
    case "zig":
      return <FileCode size={16} className="text-muted-foreground" />;
    case "json":
    case "yaml":
    case "yml":
    case "toml":
      return <Code size={16} className="text-muted-foreground" />;
    case "md":
    case "mdx":
    case "txt":
    case "csv":
      return <File size={16} className="text-muted-foreground" />;
    default:
      return <File size={16} className="text-muted-foreground" />;
  }
}

function containsMatch(node: FileTreeNode, query: string): boolean {
  const q = query.toLowerCase();
  if (node.name.toLowerCase().includes(q)) return true;
  if (node.children) {
    return node.children.some((child) => containsMatch(child, q));
  }
  return false;
}

function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  if (!query) return nodes;
  return nodes
    .filter((node) => containsMatch(node, query))
    .map((node) => ({
      ...node,
      children: node.children ? filterTree(node.children, query) : undefined,
    }));
}

function LazyFolder({
  node,
  searchQuery,
  workingDirectory,
  onLazyLoad,
}: {
  node: FileTreeNode;
  searchQuery: string;
  workingDirectory: string;
  onLazyLoad: (parentPath: string, children: FileTreeNode[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const needsLazyLoad = node.type === "directory" && !node.children;

  const handleExpand = useCallback(async () => {
    if (!needsLazyLoad || loading) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/files?dir=${encodeURIComponent(node.path)}&baseDir=${encodeURIComponent(workingDirectory)}&depth=3&_t=${Date.now()}`
      );
      if (res.ok) {
        const data = await res.json();
        onLazyLoad(node.path, data.tree || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [needsLazyLoad, loading, node.path, workingDirectory, onLazyLoad]);

  return (
    <FileTreeFolder key={node.path} path={node.path} name={node.name} onExpand={needsLazyLoad ? handleExpand : undefined}>
      {loading ? (
        <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
          <ArrowsClockwise size={12} className="animate-spin" />
        </div>
      ) : node.children ? (
        <RenderTreeNodes nodes={node.children} searchQuery={searchQuery} workingDirectory={workingDirectory} onLazyLoad={onLazyLoad} />
      ) : null}
    </FileTreeFolder>
  );
}

function RenderTreeNodes({
  nodes,
  searchQuery,
  workingDirectory,
  onLazyLoad,
}: {
  nodes: FileTreeNode[];
  searchQuery: string;
  workingDirectory: string;
  onLazyLoad: (parentPath: string, children: FileTreeNode[]) => void;
}) {
  const filtered = searchQuery ? filterTree(nodes, searchQuery) : nodes;

  return (
    <>
      {filtered.map((node) => {
        if (node.type === "directory") {
          return (
            <LazyFolder
              key={node.path}
              node={node}
              searchQuery={searchQuery}
              workingDirectory={workingDirectory}
              onLazyLoad={onLazyLoad}
            />
          );
        }
        return (
          <FileTreeFile
            key={node.path}
            path={node.path}
            name={node.name}
            icon={getFileIcon(node.extension)}
          />
        );
      })}
    </>
  );
}

export function FileTree({ workingDirectory, onFileSelect, onFileAdd }: FileTreeProps) {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; isDirectory: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragCounterRef = useRef(0);
  const { t } = useTranslation();

  const fetchTree = useCallback(async () => {
    // Always cancel in-flight request first — even when clearing directory,
    // otherwise a stale response from the old project can arrive and repopulate the tree.
    if (abortRef.current) {
      abortRef.current.abort();
    }

    if (!workingDirectory) {
      abortRef.current = null;
      setTree([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/files?dir=${encodeURIComponent(workingDirectory)}&baseDir=${encodeURIComponent(workingDirectory)}&depth=4&_t=${Date.now()}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      if (res.ok) {
        const data = await res.json();
        if (controller.signal.aborted) return;
        setTree(data.tree || []);
      } else {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        setTree([]);
        setError(errData.error || `Failed to load (${res.status})`);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setTree([]);
      setError('Failed to load file tree');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [workingDirectory]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  // Auto-refresh when AI finishes streaming
  useEffect(() => {
    const handler = () => fetchTree();
    window.addEventListener('refresh-file-tree', handler);
    return () => window.removeEventListener('refresh-file-tree', handler);
  }, [fetchTree]);

  // Merge lazily-loaded children into the tree
  const handleLazyLoad = useCallback((parentPath: string, children: FileTreeNode[]) => {
    setTree((prev) => {
      const update = (nodes: FileTreeNode[]): FileTreeNode[] =>
        nodes.map((n) => {
          if (n.path === parentPath) {
            return { ...n, children };
          }
          if (n.children) {
            return { ...n, children: update(n.children) };
          }
          return n;
        });
      return update(prev);
    });
  }, []);

  const handleDeleteRequest = useCallback((filePath: string, isDirectory: boolean) => {
    setDeleteTarget({ path: filePath, isDirectory });
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget || !workingDirectory) return;
    try {
      const res = await fetch('/api/files', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: deleteTarget.path, baseDir: workingDirectory }),
      });
      if (res.ok) {
        fetchTree();
      }
    } catch {
      // silently fail
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, workingDirectory, fetchTree]);

  const handleUpload = useCallback(async (files: FileList) => {
    if (!workingDirectory || files.length === 0) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const formData = new FormData();
      formData.append('dir', workingDirectory);
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
      const res = await fetch('/api/files/upload', { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        const hasExtracted = data.files?.some((f: { extracted?: boolean }) => f.extracted);
        setUploadMsg(
          hasExtracted
            ? t('fileTree.archiveExtracted')
            : t('fileTree.uploadSuccess').replace('{count}', String(data.files?.length ?? files.length))
        );
        fetchTree();
        setTimeout(() => setUploadMsg(null), 3000);
      }
    } catch {
      // silently fail
    } finally {
      setUploading(false);
    }
  }, [workingDirectory, fetchTree, t]);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  }, [handleUpload]);

  // Default to all directories collapsed
  const defaultExpanded = new Set<string>();

  return (
    <div
      className="flex flex-col h-full min-h-0 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragOver && workingDirectory && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-primary/5 border-2 border-dashed border-primary rounded-md pointer-events-none">
          <UploadSimple size={32} className="text-primary mb-2" />
          <span className="text-sm font-medium text-primary">{t('fileTree.dropActive')}</span>
        </div>
      )}

      {/* Search + Refresh */}
      <div className="flex items-center gap-1.5 px-4 py-2 shrink-0">
        <div className="relative flex-1 min-w-0">
          <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t('fileTree.filterFiles')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={fetchTree}
          disabled={loading}
          className="h-7 w-7 shrink-0"
        >
          <ArrowsClockwise size={12} className={cn(loading && "animate-spin")} />
          <span className="sr-only">{t('fileTree.refresh')}</span>
        </Button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto">
        {loading && tree.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <ArrowsClockwise size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : tree.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {error ? error : workingDirectory ? t('fileTree.noFiles') : t('fileTree.selectFolder')}
          </p>
        ) : (
          <AIFileTree
            defaultExpanded={defaultExpanded}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI Elements FileTree onSelect type conflicts with HTMLAttributes.onSelect
            onSelect={onFileSelect as any}
            onAdd={onFileAdd}
            onDelete={handleDeleteRequest}
            className="border-0 rounded-none"
          >
            <RenderTreeNodes nodes={tree} searchQuery={searchQuery} workingDirectory={workingDirectory} onLazyLoad={handleLazyLoad} />
          </AIFileTree>
        )}
      </div>

      {/* Drop hint / upload status */}
      {workingDirectory && (
        <div className="shrink-0 border-t border-border/40 px-3 py-2">
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <ArrowsClockwise size={12} className="animate-spin" />
              <span>{t('fileTree.uploading')}</span>
            </div>
          ) : uploadMsg ? (
            <p className="text-center text-xs text-primary">{uploadMsg}</p>
          ) : (
            <p className="text-center text-xs text-muted-foreground">{t('fileTree.dropHint')}</p>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('fileTree.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.isDirectory
                ? t('fileTree.deleteConfirmFolder').replace('{name}', deleteTarget?.path.split('/').pop() || '')
                : t('fileTree.deleteConfirmFile').replace('{name}', deleteTarget?.path.split('/').pop() || '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('fileTree.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
