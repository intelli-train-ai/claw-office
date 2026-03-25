import { NextResponse } from 'next/server';
import { getDb, createSession, addMessage, createTask, createProvider, createPermissionRequest } from '@/lib/db';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * GET /api/api-test/seed
 *
 * Creates a complete set of example data for API testing.
 * Idempotent: checks for existing test data before creating.
 * Returns all IDs needed by every endpoint in the API tester.
 */
export async function GET() {
  try {
    const db = getDb();
    const prefix = '__apitest__';

    // ── 1. Provider ──
    let provider = db.prepare(
      "SELECT * FROM api_providers WHERE name = ?"
    ).get(prefix + 'provider') as Record<string, unknown> | undefined;

    if (!provider) {
      provider = createProvider({
        name: prefix + 'provider',
        provider_type: 'anthropic',
        base_url: '',
        api_key: 'sk-ant-test-000000000000000000000000',
        notes: 'Auto-created by API Tester seed',
      }) as unknown as Record<string, unknown>;
    }
    const providerId = String(provider.id);

    // ── 2. Session ──
    let session = db.prepare(
      "SELECT * FROM chat_sessions WHERE title = ? AND status = 'active'"
    ).get(prefix + 'session') as Record<string, unknown> | undefined;

    if (!session) {
      session = createSession(
        prefix + 'session',
        'claude-sonnet-4-20250514',
        'You are a helpful test assistant.',
        process.cwd(),
        'code',
        providerId,
      ) as unknown as Record<string, unknown>;
    }
    const sessionId = String(session.id);

    // ── 3. Messages ──
    const existingMsgs = db.prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 10"
    ).all(sessionId) as Record<string, unknown>[];

    let userMsgId = '';
    let assistantMsgId = '';

    if (existingMsgs.length < 2) {
      const userMsg = addMessage(
        sessionId,
        'user',
        'Hello! This is a test message from the API Tester.',
      ) as unknown as Record<string, unknown>;
      userMsgId = String(userMsg.id);

      const assistantMsg = addMessage(
        sessionId,
        'assistant',
        JSON.stringify([{
          type: 'text',
          text: 'Hello! I received your test message. The API is working correctly. How can I help you today?',
        }]),
        JSON.stringify({ input_tokens: 25, output_tokens: 30 }),
      ) as unknown as Record<string, unknown>;
      assistantMsgId = String(assistantMsg.id);

      // Add a second exchange
      addMessage(sessionId, 'user', 'Can you help me test the API endpoints?');
      addMessage(
        sessionId,
        'assistant',
        JSON.stringify([{
          type: 'text',
          text: 'Of course! All endpoints are pre-filled with test data. Just click any endpoint in the sidebar and hit Send.',
        }]),
        JSON.stringify({ input_tokens: 40, output_tokens: 35 }),
      );
    } else {
      userMsgId = String(existingMsgs.find((m) => m.role === 'user')?.id || existingMsgs[0].id);
      assistantMsgId = String(existingMsgs.find((m) => m.role === 'assistant')?.id || existingMsgs[1]?.id || '');
    }

    // ── 4. Tasks ──
    const existingTasks = db.prepare(
      "SELECT * FROM tasks WHERE session_id = ? LIMIT 5"
    ).all(sessionId) as Record<string, unknown>[];

    let taskId = '';

    if (existingTasks.length === 0) {
      const task1 = createTask(sessionId, 'Review API endpoints', 'Check all GET endpoints return 200') as unknown as Record<string, unknown>;
      taskId = String(task1.id);
      createTask(sessionId, 'Test POST endpoints', 'Verify create operations work');
      createTask(sessionId, 'Validate error handling', 'Check 4xx responses for bad input');
    } else {
      taskId = String(existingTasks[0].id);
    }

    // ── 5. Media Tag ──
    let tag = db.prepare(
      "SELECT * FROM media_tags WHERE name = ?"
    ).get(prefix + 'tag') as Record<string, unknown> | undefined;

    if (!tag) {
      db.prepare(
        "INSERT INTO media_tags (name, color) VALUES (?, ?)"
      ).run(prefix + 'tag', '#6366f1');
      tag = db.prepare(
        "SELECT * FROM media_tags WHERE name = ?"
      ).get(prefix + 'tag') as Record<string, unknown>;
    }
    const tagId = String(tag?.id || '');

    // ── 6. Check for existing media/jobs (read-only, don't create) ──
    const media = db.prepare(
      "SELECT id FROM media_generations ORDER BY created_at DESC LIMIT 1"
    ).get() as Record<string, unknown> | undefined;
    const mediaId = String(media?.id || '0');

    let jobId = '0';
    try {
      const job = db.prepare(
        "SELECT id FROM media_jobs ORDER BY created_at DESC LIMIT 1"
      ).get() as Record<string, unknown> | undefined;
      jobId = String(job?.id || '0');
    } catch {
      // table may not exist
    }

    // ── 7. Skills ──
    let skillNames: string[] = [];
    try {
      const skills = db.prepare(
        "SELECT name FROM skills LIMIT 5"
      ).all() as Record<string, unknown>[];
      skillNames = skills.map(s => String(s.name));
    } catch {
      // skills table may not exist in DB
    }

    // ── 8. Permission Request ──
    let permissionRequestId = '';
    try {
      const existingPR = db.prepare(
        "SELECT id FROM permission_requests WHERE tool_name = ? AND status = 'pending'"
      ).get(prefix + 'tool') as Record<string, unknown> | undefined;

      if (existingPR) {
        permissionRequestId = String(existingPR.id);
      } else {
        permissionRequestId = crypto.randomBytes(16).toString('hex');
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];
        createPermissionRequest({
          id: permissionRequestId,
          sessionId,
          toolName: prefix + 'tool',
          toolInput: JSON.stringify({ command: 'echo hello', description: 'Test tool invocation' }),
          decisionReason: 'Auto-created by API Tester seed',
          expiresAt: expires,
        });
      }
    } catch {
      // permission_requests table may not exist
    }

    // ── 9. Skill file (global command) ──
    const globalCmdsDir = path.join(os.homedir(), '.claude', 'commands');
    const skillFilePath = path.join(globalCmdsDir, prefix + 'skill.md');
    if (!fs.existsSync(skillFilePath)) {
      fs.mkdirSync(globalCmdsDir, { recursive: true });
      fs.writeFileSync(skillFilePath, '# Test Skill\nCreated by API Tester.', 'utf-8');
    }

    // ── Result ──
    const result = {
      ok: true,
      context: {
        sessionId,
        userMessageId: userMsgId,
        assistantMessageId: assistantMsgId,
        providerId,
        taskId,
        tagId,
        mediaId,
        jobId,
        permissionRequestId,
        workingDirectory: process.cwd(),
        skillNames,
      },
      summary: {
        session: prefix + 'session (id: ' + sessionId.substring(0, 12) + '...)',
        messages: existingMsgs.length < 2 ? '4 created' : existingMsgs.length + ' existing',
        tasks: existingTasks.length === 0 ? '3 created' : existingTasks.length + ' existing',
        provider: prefix + 'provider (id: ' + providerId.substring(0, 12) + '...)',
        tag: prefix + 'tag (id: ' + tagId + ')',
      },
    };

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/api-test/seed
 *
 * Cleans up all test data created by the seed endpoint.
 */
export async function DELETE() {
  try {
    const db = getDb();
    const prefix = '__apitest__';

    // Find test session
    const session = db.prepare(
      "SELECT id FROM chat_sessions WHERE title = ?"
    ).get(prefix + 'session') as Record<string, unknown> | undefined;

    if (session) {
      const sid = String(session.id);
      // CASCADE will delete messages and tasks
      db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sid);
    }

    // Delete test provider
    db.prepare("DELETE FROM api_providers WHERE name = ?").run(prefix + 'provider');

    // Delete test tag
    db.prepare("DELETE FROM media_tags WHERE name = ?").run(prefix + 'tag');

    // Delete test permission requests
    try {
      db.prepare("DELETE FROM permission_requests WHERE tool_name = ?").run(prefix + 'tool');
    } catch {
      // table may not exist
    }

    // Delete test skill file
    try {
      const skillFile = path.join(os.homedir(), '.claude', 'commands', prefix + 'skill.md');
      if (fs.existsSync(skillFile)) fs.unlinkSync(skillFile);
    } catch {
      // ignore
    }

    return NextResponse.json({ ok: true, cleaned: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 },
    );
  }
}
