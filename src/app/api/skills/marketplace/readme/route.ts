import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { requireAuth } from '@/lib/auth';

// Local cache directory (same as search route)
const CACHE_DIR = path.join(os.tmpdir(), "codepilot-skills-cache");

/**
 * Find SKILL.md for a given skillId by scanning the local repo cache.
 */
function findSkillMd(skillId: string): string | null {
  function walk(dir: string, depth: number): string | null {
    if (depth > 3) return null;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name.startsWith("_") || entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.name === skillId) {
        const skillMd = path.join(fullPath, "SKILL.md");
        if (fs.existsSync(skillMd)) return skillMd;
      }
      const found = walk(fullPath, depth + 1);
      if (found) return found;
    }
    return null;
  }
  return walk(CACHE_DIR, 0);
}

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const skillId = request.nextUrl.searchParams.get("skillId") || "";

    if (!skillId) {
      return NextResponse.json(
        { error: "skillId is required" },
        { status: 400 }
      );
    }

    // Check if local cache exists
    if (!fs.existsSync(CACHE_DIR)) {
      return NextResponse.json({ content: null }, { status: 200 });
    }

    const skillMdPath = findSkillMd(skillId);
    if (!skillMdPath) {
      return NextResponse.json({ content: null }, { status: 200 });
    }

    const content = fs.readFileSync(skillMdPath, "utf-8");
    return NextResponse.json({ content });
  } catch (error) {
    console.error("[marketplace/readme] Error:", error);
    return NextResponse.json({ content: null }, { status: 200 });
  }
}
