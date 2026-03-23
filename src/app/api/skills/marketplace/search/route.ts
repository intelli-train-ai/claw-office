import { NextRequest, NextResponse } from "next/server";
import { readLockFile } from "@/lib/skills-lock";
import type { MarketplaceSkill } from "@/types";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// GitHub repo to use as skill marketplace
const SKILLS_REPO = "intelli-train-ai/skills";
const SKILLS_REPO_URL = `https://github.com/${SKILLS_REPO}.git`;

// Local cache directory
const CACHE_DIR = path.join(os.tmpdir(), "codepilot-skills-cache");

// In-memory cache for the skill list
let skillsCache: { skills: MarketplaceSkill[]; ts: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Ensure the skills repo is cloned/updated locally.
 */
function ensureLocalRepo(): void {
  if (fs.existsSync(path.join(CACHE_DIR, ".git"))) {
    // Pull latest (silently, ignore errors)
    try {
      execSync("git pull --ff-only -q", { cwd: CACHE_DIR, timeout: 30000, stdio: "ignore" });
    } catch {
      // ignore pull errors, use cached version
    }
  } else {
    // Clone fresh
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    execSync(`git clone --depth 1 -q ${SKILLS_REPO_URL} ${CACHE_DIR}`, { timeout: 60000, stdio: "ignore" });
  }
}

/**
 * Scan the local repo for all SKILL.md files and build skill list.
 */
function scanSkillsFromLocal(): MarketplaceSkill[] {
  if (skillsCache && Date.now() - skillsCache.ts < CACHE_TTL) {
    return skillsCache.skills;
  }

  ensureLocalRepo();

  const skills: MarketplaceSkill[] = [];
  const seen = new Set<string>();

  function walk(dir: string, depth: number) {
    if (depth > 3) return; // Don't go too deep
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.startsWith("_") || entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Check if this directory has a SKILL.md
        const skillMd = path.join(fullPath, "SKILL.md");
        if (fs.existsSync(skillMd) && !seen.has(entry.name)) {
          seen.add(entry.name);
          skills.push({
            id: entry.name,
            skillId: entry.name,
            name: entry.name,
            installs: 0,
            source: `${SKILLS_REPO}/${entry.name}`,
            isInstalled: false,
          });
        }
        walk(fullPath, depth + 1);
      }
    }
  }

  walk(CACHE_DIR, 0);
  skills.sort((a, b) => a.name.localeCompare(b.name));

  skillsCache = { skills, ts: Date.now() };
  return skills;
}

export async function GET(request: NextRequest) {
  try {
    const q = (request.nextUrl.searchParams.get("q") || "").toLowerCase().trim();

    const allSkills = scanSkillsFromLocal();

    // Filter by search query
    let filtered = allSkills;
    if (q.length >= 1) {
      filtered = allSkills.filter(
        (s) => s.name.toLowerCase().includes(q) || s.skillId.toLowerCase().includes(q)
      );
    }

    // Limit results
    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "20", 10);
    const results = filtered.slice(0, limit);

    // Read lock file to mark installed skills
    const lockFile = readLockFile();
    const installedSources = new Set(
      Object.values(lockFile.skills).map((entry) => entry.source)
    );

    const skills: MarketplaceSkill[] = results.map((skill) => {
      const installedEntry = Object.values(lockFile.skills).find(
        (entry) => entry.source === skill.source || entry.source === `${SKILLS_REPO}/${skill.skillId}`
      );
      return {
        ...skill,
        isInstalled: installedSources.has(skill.source) || !!installedEntry,
        installedAt: installedEntry?.installedAt,
      };
    });

    return NextResponse.json({ skills });
  } catch (error) {
    console.error("[marketplace/search] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 502 }
    );
  }
}
