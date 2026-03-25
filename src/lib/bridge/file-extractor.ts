/**
 * Extract file paths from Claude's response text and convert them
 * to OutboundAttachment objects for sending via IM channels.
 *
 * Detects absolute file paths (e.g. /home/user/file.pptx) in the response,
 * checks if they exist on disk, and creates attachments for sendable file types.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { OutboundAttachment } from './types';

const LOG_TAG = '[file-extractor]';

/** Max file size to auto-attach (30 MB — Feishu limit) */
const MAX_FILE_SIZE = 30 * 1024 * 1024;

/** File extensions we consider worth sending as attachments */
const SENDABLE_EXTENSIONS = new Set([
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt',
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
  // Videos
  '.mp4', '.mov', '.avi', '.webm',
  // Audio
  '.mp3', '.wav', '.ogg', '.opus',
  // Archives
  '.zip', '.tar', '.gz',
]);

/** Map file extension to MIME type */
function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Extract absolute file paths from response text.
 * Matches paths like /home/user/file.pptx that appear in the text.
 */
function findFilePaths(text: string): string[] {
  // Match absolute paths with known extensions
  const extPattern = [...SENDABLE_EXTENSIONS].map(e => e.replace('.', '\\.')).join('|');
  const regex = new RegExp(`(/[\\w.\\-/]+(?:${extPattern}))`, 'gi');
  const matches = text.match(regex) || [];
  // Deduplicate
  return [...new Set(matches)];
}

/**
 * Extract file paths from Claude's response text and return
 * OutboundAttachment objects for files that exist and are sendable.
 */
export function extractFilePathsFromText(text: string): OutboundAttachment[] {
  const paths = findFilePaths(text);
  if (paths.length === 0) return [];

  const attachments: OutboundAttachment[] = [];

  for (const filePath of paths) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      if (stat.size === 0) continue;
      if (stat.size > MAX_FILE_SIZE) {
        console.warn(LOG_TAG, `Skipping "${filePath}": too large (${stat.size} bytes)`);
        continue;
      }

      const ext = path.extname(filePath).toLowerCase();
      if (!SENDABLE_EXTENSIONS.has(ext)) continue;

      attachments.push({
        name: path.basename(filePath),
        mimeType: mimeFromExt(ext),
        data: filePath,  // Pass path string — outbound.ts will read it
        size: stat.size,
      });

      console.log(LOG_TAG, `Detected file: ${filePath} (${stat.size} bytes)`);
    } catch {
      // File doesn't exist or not accessible — skip
    }
  }

  return attachments;
}
