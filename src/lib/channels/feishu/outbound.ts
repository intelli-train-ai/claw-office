/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Feishu outbound message rendering and sending.
 *
 * Text messages use `post` format with `md` tag for markdown rendering.
 * Card messages (buttons, permissions) use Schema V2 interactive cards.
 * Media messages (images, files, videos) are uploaded then sent as separate messages.
 *
 * Markdown is optimized for Feishu: heading demotion, table spacing,
 * code block padding, and invalid image key stripping.
 */

import * as fs from 'fs';
import type * as lark from '@larksuiteoapi/node-sdk';
import type { OutboundAttachment, OutboundMessage, SendResult } from '../../bridge/types';

/** Extract error message from unknown catch value */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Lark IM message response shape (shared by create/reply) */
interface LarkMessageResponse {
  code?: number;
  msg?: string;
  data?: { message_id?: string };
}

const LOG_TAG = '[feishu/outbound]';

// ─── Markdown optimization for Feishu ────────────────────────────────────────

/**
 * Optimize markdown for Feishu rendering compatibility.
 *
 * Based on OpenClaw's markdown-style.ts:
 * - Demote headings: H1 → H4, H2-H6 → H5 (Feishu renders H1-H3 too large)
 * - Add spacing around tables with <br> tags
 * - Pad code blocks with <br> for visual separation
 * - Strip invalid image keys (prevent CardKit error 200570)
 * - Compress excessive newlines (3+ → 2)
 */
export function optimizeMarkdown(text: string): string {
  try {
    return _optimizeMarkdown(text);
  } catch {
    return text;
  }
}

function _optimizeMarkdown(text: string): string {
  // 1. Extract code blocks — protect from transformation
  const MARK = '___CB_';
  const codeBlocks: string[] = [];
  let r = text.replace(/```[\s\S]*?```/g, (m) => {
    return `${MARK}${codeBlocks.push(m) - 1}___`;
  });

  // 2. Heading demotion (only if H1-H3 exist)
  // Feishu renders H1-H3 too large in post md tag
  const hasLargeHeadings = /^#{1,3} /m.test(r);
  if (hasLargeHeadings) {
    r = r.replace(/^#{2,6} (.+)$/gm, '##### $1'); // H2-H6 → H5
    r = r.replace(/^# (.+)$/gm, '#### $1');        // H1 → H4
  }

  // 3. Spacing between consecutive headings
  r = r.replace(/^(#{4,5} .+)\n{1,2}(#{4,5} )/gm, '$1\n\n$2');

  // 4. Table spacing — ensure blank line before/after table blocks
  r = r.replace(/^([^|\n].*)\n(\|.+\|)/gm, '$1\n\n$2');
  r = r.replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gm, '\n\n$1\n\n');

  // 5. Restore code blocks with blank line padding
  // Note: Feishu post md tag does NOT support <br> — use blank lines instead
  codeBlocks.forEach((block, i) => {
    r = r.replace(`${MARK}${i}___`, `\n\n${block}\n\n`);
  });

  // 6. Strip invalid image keys (only allow img_xxx and http(s) URLs)
  if (r.includes('![')) {
    r = r.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_full, _alt, value) => {
      if (value.startsWith('img_') || value.startsWith('http://') || value.startsWith('https://')) {
        return _full;
      }
      return value;
    });
  }

  // 7. Compress excessive newlines (3+ → 2)
  r = r.replace(/\n{3,}/g, '\n\n');

  return r;
}

/**
 * Convert HTML-formatted text (from permission-broker) to Feishu markdown.
 */
function htmlToFeishuMarkdown(text: string): string {
  return text
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre>([\s\S]*?)<\/pre>/gi, '```\n$1\n```')
    .replace(/<\/?[^>]+>/g, '');
}

// ─── Media upload limits ─────────────────────────────────────────────────────

const IMAGE_MAX_SIZE = 10 * 1024 * 1024;  // 10 MB
const FILE_MAX_SIZE = 30 * 1024 * 1024;   // 30 MB

/** Map MIME type to Feishu file_type for im.file.create */
function resolveFileType(mimeType: string): 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream' {
  if (mimeType.startsWith('video/') || mimeType === 'video/mp4') return 'mp4';
  if (mimeType.startsWith('audio/')) return 'opus';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('word') || mimeType.includes('msword')) return 'doc';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'xls';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return 'ppt';
  return 'stream';
}

/** Read attachment data as Buffer */
function readAttachmentBuffer(attachment: OutboundAttachment): Buffer {
  if (Buffer.isBuffer(attachment.data)) return attachment.data;
  // string → file path
  return fs.readFileSync(attachment.data);
}

// ─── Media upload ────────────────────────────────────────────────────────────

/**
 * Upload an image to Feishu and return the image_key.
 * Supports JPEG, PNG, WEBP, GIF, TIFF, BMP, ICO. Max 10 MB.
 */
export async function uploadImage(
  client: lark.Client,
  attachment: OutboundAttachment,
): Promise<string> {
  if (attachment.size > IMAGE_MAX_SIZE) {
    throw new Error(`Image too large: ${attachment.size} bytes (max ${IMAGE_MAX_SIZE})`);
  }
  const buf = readAttachmentBuffer(attachment);
  const resp = await (client.im.image.create as any)({
    data: { image_type: 'message', image: buf },
  });
  const imageKey = resp?.data?.image_key || resp?.image_key;
  if (!imageKey) throw new Error('Upload image failed: no image_key returned');
  console.log(LOG_TAG, 'Uploaded image:', imageKey, `(${attachment.name})`);
  return imageKey;
}

/**
 * Upload a file (document, video, audio, etc.) to Feishu and return the file_key.
 * Max 30 MB.
 */
export async function uploadFile(
  client: lark.Client,
  attachment: OutboundAttachment,
): Promise<string> {
  if (attachment.size > FILE_MAX_SIZE) {
    throw new Error(`File too large: ${attachment.size} bytes (max ${FILE_MAX_SIZE})`);
  }
  const buf = readAttachmentBuffer(attachment);
  const fileType = resolveFileType(attachment.mimeType);
  const resp = await (client.im.file.create as any)({
    data: {
      file_type: fileType,
      file_name: attachment.name,
      file: buf,
    },
  });
  const fileKey = resp?.data?.file_key || resp?.file_key;
  if (!fileKey) throw new Error('Upload file failed: no file_key returned');
  console.log(LOG_TAG, 'Uploaded file:', fileKey, `(${attachment.name}, type=${fileType})`);
  return fileKey;
}

// ─── Media message sending ───────────────────────────────────────────────────

/** Send an uploaded image as a standalone message */
async function sendImageMessage(
  client: lark.Client,
  chatId: string,
  imageKey: string,
  replyToMessageId?: string,
): Promise<SendResult> {
  const content = JSON.stringify({ image_key: imageKey });
  let resp: any;
  if (replyToMessageId) {
    resp = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: { content, msg_type: 'image' },
    });
  } else {
    resp = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, content, msg_type: 'image' },
    });
  }
  const msgId = resp?.data?.message_id || '';
  console.log(LOG_TAG, 'Sent image message:', msgId);
  return { ok: true, messageId: msgId };
}

/** Send an uploaded video as a standalone message */
async function sendVideoMessage(
  client: lark.Client,
  chatId: string,
  fileKey: string,
  imageKey?: string,
  replyToMessageId?: string,
): Promise<SendResult> {
  const content = JSON.stringify({
    file_key: fileKey,
    image_key: imageKey || '',  // cover image (optional)
  });
  let resp: any;
  if (replyToMessageId) {
    resp = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: { content, msg_type: 'media' },
    });
  } else {
    resp = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, content, msg_type: 'media' },
    });
  }
  const msgId = resp?.data?.message_id || '';
  console.log(LOG_TAG, 'Sent video message:', msgId);
  return { ok: true, messageId: msgId };
}

/** Send an uploaded file as a standalone message */
async function sendFileMessage(
  client: lark.Client,
  chatId: string,
  fileKey: string,
  replyToMessageId?: string,
): Promise<SendResult> {
  const content = JSON.stringify({ file_key: fileKey });
  let resp: any;
  if (replyToMessageId) {
    resp = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: { content, msg_type: 'file' },
    });
  } else {
    resp = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, content, msg_type: 'file' },
    });
  }
  const msgId = resp?.data?.message_id || '';
  console.log(LOG_TAG, 'Sent file message:', msgId);
  return { ok: true, messageId: msgId };
}

/**
 * Upload and send a single attachment. Automatically picks the right
 * upload API and message type based on MIME type.
 */
export async function sendAttachment(
  client: lark.Client,
  chatId: string,
  attachment: OutboundAttachment,
  replyToMessageId?: string,
): Promise<SendResult> {
  const mime = attachment.mimeType;

  if (mime.startsWith('image/')) {
    const imageKey = await uploadImage(client, attachment);
    return sendImageMessage(client, chatId, imageKey, replyToMessageId);
  }

  if (mime.startsWith('video/')) {
    const fileKey = await uploadFile(client, attachment);
    return sendVideoMessage(client, chatId, fileKey, undefined, replyToMessageId);
  }

  // Everything else → file message
  const fileKey = await uploadFile(client, attachment);
  return sendFileMessage(client, chatId, fileKey, replyToMessageId);
}

// ─── Message sending ─────────────────────────────────────────────────────────

/**
 * Send a message to Feishu.
 *
 * - With inlineButtons → interactive card (Schema V2)
 * - With attachments → upload & send each attachment, then text (if any)
 * - Without → post format with md tag (supports markdown rendering)
 */
export async function sendMessage(
  client: lark.Client,
  message: OutboundMessage,
): Promise<SendResult> {
  try {
    const chatId = message.address.chatId.split(':thread:')[0];
    const replyId = message.replyToMessageId;

    // Send attachments first (each as a separate message)
    if (message.attachments && message.attachments.length > 0) {
      let lastResult: SendResult = { ok: true };
      for (const attachment of message.attachments) {
        try {
          lastResult = await sendAttachment(client, chatId, attachment, replyId);
        } catch (err: any) {
          console.error(LOG_TAG, `Failed to send attachment "${attachment.name}":`, err?.message || err);
          // Continue with remaining attachments
        }
      }
      // If there's also text, send it after the attachments
      if (message.text.trim()) {
        return sendAsPost(client, chatId, message.text, message.parseMode, replyId);
      }
      return lastResult;
    }

    // Interactive card for messages with buttons
    if (message.inlineButtons && message.inlineButtons.length > 0) {
      return sendAsInteractiveCard(client, chatId, message.text, message.inlineButtons, replyId);
    }

    // Post format with md tag for markdown support
    return sendAsPost(client, chatId, message.text, message.parseMode, replyId);
  } catch (err: unknown) {
    console.error(LOG_TAG, 'Send failed:', errMsg(err));
    return { ok: false, error: errMsg(err) };
  }
}

/**
 * Send a message using post format with md tag.
 * This enables markdown rendering in Feishu (bold, code, lists, tables, etc).
 */
async function sendAsPost(
  client: lark.Client,
  chatId: string,
  text: string,
  parseMode?: string,
  replyToMessageId?: string,
): Promise<SendResult> {
  // Convert HTML to markdown if needed, then optimize for Feishu
  let mdText = parseMode === 'HTML' ? htmlToFeishuMarkdown(text) : text;
  mdText = optimizeMarkdown(mdText);

  const content = JSON.stringify({
    zh_cn: {
      content: [[{ tag: 'md', text: mdText }]],
    },
  });

  let resp: LarkMessageResponse;
  if (replyToMessageId) {
    resp = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: { content, msg_type: 'post' },
    });
  } else {
    resp = await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, content, msg_type: 'post' },
    });
  }

  const msgId = resp?.data?.message_id || '';
  return { ok: true, messageId: msgId };
}

// ─── Interactive cards ───────────────────────────────────────────────────────

/**
 * Build and send a Feishu interactive card with buttons.
 *
 * Uses Schema V2 with:
 * - markdown element for text content
 * - action element for buttons (Allow = primary, Deny = danger)
 */
async function sendAsInteractiveCard(
  client: lark.Client,
  chatId: string,
  text: string,
  inlineButtons: import('../../bridge/types').InlineButton[][],
  replyToMessageId?: string,
): Promise<SendResult> {
  try {
    const mdText = htmlToFeishuMarkdown(text);

    // Detect card type from button callback data
    const firstCallback = inlineButtons[0]?.[0]?.callbackData || '';
    const isPermission = firstCallback.startsWith('perm:');
    const isCwd = firstCallback.startsWith('cwd:');

    // Build button elements
    const allButtons = inlineButtons.flat();
    const buttonColumns = allButtons.map((btn) => {
      let btnType: 'primary' | 'danger' | 'default' = 'default';
      const lowerText = btn.text.toLowerCase();
      if (lowerText.includes('deny') || lowerText.includes('拒绝')) {
        btnType = 'danger';
      } else if (lowerText.includes('allow') || lowerText.includes('允许')) {
        btnType = 'primary';
      } else if (btn.text.startsWith('📍')) {
        btnType = 'primary'; // Current project highlighted
      }

      return {
        tag: 'column' as const,
        width: isCwd ? 'weighted' as const : 'auto' as const,
        weight: isCwd ? 1 : undefined,
        elements: [
          {
            tag: 'button' as const,
            text: { tag: 'plain_text' as const, content: btn.text },
            type: btnType,
            size: 'medium' as const,
            value: { callback_data: btn.callbackData, chatId },
          },
        ],
      };
    });

    // Card header based on type
    const headerConfig = isPermission
      ? { title: 'Permission Required', template: 'blue' as const, icon: 'lock-chat_filled' }
      : isCwd
        ? { title: 'Switch Project', template: 'turquoise' as const, icon: 'folder_outlined' }
        : { title: 'Action Required', template: 'blue' as const, icon: 'info-circle_outlined' };

    // Build body elements
    const bodyElements: Record<string, unknown>[] = [
      {
        tag: 'markdown' as const,
        content: mdText,
        text_size: 'normal' as const,
      },
    ];

    if (isPermission) {
      bodyElements.push({
        tag: 'markdown' as const,
        content: '⏱ This request will expire in 5 minutes',
        text_size: 'notation' as const,
      });
    }

    bodyElements.push({ tag: 'hr' as const });

    // CWD card: stack buttons vertically (one per row)
    if (isCwd) {
      for (const col of buttonColumns) {
        bodyElements.push({
          tag: 'column_set' as const,
          flex_mode: 'none' as const,
          columns: [col],
        });
      }
    } else {
      bodyElements.push({
        tag: 'column_set' as const,
        flex_mode: 'none' as const,
        horizontal_align: 'left' as const,
        columns: buttonColumns,
      });
    }

    const card = {
      schema: '2.0',
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text' as const, content: headerConfig.title },
        template: headerConfig.template,
        icon: { tag: 'standard_icon' as const, token: headerConfig.icon },
        padding: '12px 12px 12px 12px',
      },
      body: { elements: bodyElements },
    };

    const cardContent = JSON.stringify(card);

    let resp: LarkMessageResponse;
    if (replyToMessageId) {
      resp = await client.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content: cardContent, msg_type: 'interactive' },
      });
    } else {
      resp = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, content: cardContent, msg_type: 'interactive' },
      });
    }

    const msgId = resp?.data?.message_id || '';
    console.log(LOG_TAG, 'Sent interactive card:', msgId);
    return { ok: true, messageId: msgId };
  } catch (err: unknown) {
    console.error(LOG_TAG, 'Interactive card send failed:', errMsg(err));
    return { ok: false, error: errMsg(err) };
  }
}

// ─── Reactions ──────────────────────────────────────────────────────────────

/**
 * Add an emoji reaction to a Feishu message.
 * Used as a "message received" acknowledgment before processing starts.
 */
export async function addReaction(
  client: lark.Client,
  messageId: string,
  emojiType: string = 'OnIt',
): Promise<string | null> {
  try {
    const resp = await client.im.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emojiType } },
    });
    return resp?.data?.reaction_id || null;
  } catch (err: unknown) {
    // Non-critical — log and swallow
    console.warn(LOG_TAG, 'Failed to add reaction:', errMsg(err));
    return null;
  }
}

/**
 * Remove an emoji reaction from a Feishu message.
 * Used to clear the "processing" indicator after response is sent.
 */
export async function removeReaction(
  client: lark.Client,
  messageId: string,
  reactionId: string,
): Promise<void> {
  try {
    await client.im.messageReaction.delete({
      path: { message_id: messageId, reaction_id: reactionId },
    });
  } catch (err: unknown) {
    console.warn(LOG_TAG, 'Failed to remove reaction:', errMsg(err));
  }
}

/**
 * Send a pre-built card (for permission cards or custom cards).
 */
export async function sendPermissionCard(
  client: lark.Client,
  chatId: string,
  cardContent: string,
  replyToMessageId?: string,
): Promise<SendResult> {
  try {
    const realChatId = chatId.split(':thread:')[0];

    let resp: LarkMessageResponse;
    if (replyToMessageId) {
      resp = await client.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content: cardContent, msg_type: 'interactive' },
      });
    } else {
      resp = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: realChatId, content: cardContent, msg_type: 'interactive' },
      });
    }

    const msgId = resp?.data?.message_id || '';
    return { ok: true, messageId: msgId };
  } catch (err: unknown) {
    console.error(LOG_TAG, 'Permission card send failed:', errMsg(err));
    return { ok: false, error: errMsg(err) };
  }
}
