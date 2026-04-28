/**
 * Seed providers from environment / file at server startup.
 *
 * Designed for Docker / headless deployments — operators can pre-populate
 * the providers list (base_url, env overrides, model mapping) via:
 *
 *   SEED_PROVIDERS_JSON='[{"preset":"deepseek-anthropic","api_key":"sk-..."}]'
 *
 *   or
 *
 *   SEED_PROVIDERS_FILE=/etc/safeclaw/providers.json
 *
 * Each entry can either reference a built-in preset by `preset` key (inherits
 * base_url / protocol / env / role models from VENDOR_PRESETS) or specify
 * everything inline.
 *
 * Behaviour:
 *  - Idempotent: matched by `name` (or preset key as fallback). Existing
 *    providers are skipped unless SEED_PROVIDERS_OVERWRITE=1 is set, in which
 *    case the api_key/base_url/env are refreshed in place.
 *  - Safe: missing/invalid JSON logs a warning and is otherwise a no-op.
 *  - Deferred imports: keeps this module side-effect-free until called.
 */
import { getPreset } from './provider-catalog';
import type { CatalogModel, RoleModels } from './provider-catalog';

interface SeedEntry {
  /** Optional preset key from VENDOR_PRESETS — supplies all defaults */
  preset?: string;
  /** Display name (defaults to preset.name) */
  name?: string;
  /** API key / auth token — required for the provider to actually work */
  api_key?: string;
  /** Override base_url (defaults to preset.baseUrl) */
  base_url?: string;
  /** Override protocol (defaults to preset.protocol) */
  protocol?: string;
  /** Extra env JSON object — merged on top of preset.defaultEnvOverrides */
  env_overrides?: Record<string, string>;
  /** Headers JSON object */
  headers?: Record<string, string>;
  /** Role models override (default/sonnet/opus/haiku/reasoning/small) */
  role_models?: RoleModels;
  /** Mark as default active provider */
  set_active?: boolean;
  /** Free-form notes */
  notes?: string;
}

const AUTH_TOKEN_KEY = 'ANTHROPIC_AUTH_TOKEN';
const API_KEY_KEY = 'ANTHROPIC_API_KEY';

function parseSeedSource(): SeedEntry[] | null {
  const inline = process.env.SEED_PROVIDERS_JSON;
  const file = process.env.SEED_PROVIDERS_FILE;

  if (inline && inline.trim()) {
    try {
      const parsed = JSON.parse(inline);
      if (!Array.isArray(parsed)) {
        console.warn('[seed-providers] SEED_PROVIDERS_JSON must be an array; got', typeof parsed);
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn('[seed-providers] Failed to parse SEED_PROVIDERS_JSON:', (err as Error).message);
      return null;
    }
  }

  if (file && file.trim()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn(`[seed-providers] ${file} must contain a JSON array`);
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn(`[seed-providers] Failed to read ${file}:`, (err as Error).message);
      return null;
    }
  }

  return null;
}

function rolesFromModels(models: CatalogModel[]): RoleModels {
  const roles: RoleModels = {};
  for (const m of models) {
    if (!m.role) continue;
    const upstream = m.upstreamModelId || m.modelId;
    if (m.role === 'default' && !roles.default) roles.default = upstream;
    if (m.role === 'sonnet' && !roles.sonnet) roles.sonnet = upstream;
    if (m.role === 'opus' && !roles.opus) roles.opus = upstream;
    if (m.role === 'haiku' && !roles.haiku) roles.haiku = upstream;
    if (m.role === 'reasoning' && !roles.reasoning) roles.reasoning = upstream;
    if (m.role === 'small' && !roles.small) roles.small = upstream;
  }
  return roles;
}

interface ResolvedSeed {
  name: string;
  protocol: string;
  base_url: string;
  api_key: string;
  extra_env_obj: Record<string, string>;
  env_overrides_obj: Record<string, string>;
  headers_obj: Record<string, string>;
  role_models_obj: RoleModels;
  notes: string;
}

function resolveEntry(entry: SeedEntry): ResolvedSeed | null {
  const preset = entry.preset ? getPreset(entry.preset) : undefined;
  if (entry.preset && !preset) {
    console.warn(`[seed-providers] Unknown preset key: ${entry.preset} — skipping`);
    return null;
  }

  const name = entry.name?.trim() || preset?.name?.trim();
  if (!name) {
    console.warn('[seed-providers] Entry missing both `name` and `preset` — skipping');
    return null;
  }

  const protocol = entry.protocol || preset?.protocol || 'anthropic';
  const baseUrl = entry.base_url ?? preset?.baseUrl ?? '';
  const apiKey = entry.api_key ?? '';

  const env: Record<string, string> = { ...(preset?.defaultEnvOverrides || {}), ...(entry.env_overrides || {}) };

  // Inject auth into the right env slot so the Claude Code subprocess picks it up.
  // Mirrors the behaviour in toClaudeCodeEnv() — auth_token presets use ANTHROPIC_AUTH_TOKEN,
  // api_key presets use ANTHROPIC_API_KEY. We keep api_key on the row too for API calls.
  if (apiKey) {
    if (preset?.authStyle === 'auth_token') {
      env[AUTH_TOKEN_KEY] = apiKey;
    } else {
      env[API_KEY_KEY] = apiKey;
    }
  }

  const roleModels: RoleModels =
    entry.role_models ||
    preset?.defaultRoleModels ||
    (preset ? rolesFromModels(preset.defaultModels) : {});

  return {
    name,
    protocol,
    base_url: baseUrl,
    api_key: apiKey,
    extra_env_obj: env,
    env_overrides_obj: env,
    headers_obj: entry.headers || {},
    role_models_obj: roleModels,
    notes: entry.notes || '',
  };
}

/**
 * Apply seeds from env/file. Idempotent — skips providers that already exist
 * (by name) unless SEED_PROVIDERS_OVERWRITE=1.
 */
export function seedProvidersFromEnv(): void {
  const seeds = parseSeedSource();
  if (!seeds || seeds.length === 0) return;

  const overwrite = process.env.SEED_PROVIDERS_OVERWRITE === '1';

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require('./db') as typeof import('./db');

  const existing = db.getAllProviders();
  const byName = new Map(existing.map(p => [p.name, p]));

  let created = 0;
  let updated = 0;
  let activated = 0;

  for (const entry of seeds) {
    const resolved = resolveEntry(entry);
    if (!resolved) continue;

    const existingProvider = byName.get(resolved.name);

    if (existingProvider && !overwrite) {
      // Still allow promoting an already-existing provider to active.
      if (entry.set_active && !existingProvider.is_active) {
        db.activateProvider(existingProvider.id);
        db.setDefaultProviderId(existingProvider.id);
        activated++;
      }
      continue;
    }

    const payload = {
      name: resolved.name,
      provider_type: resolved.protocol === 'anthropic' ? 'anthropic' : 'custom',
      protocol: resolved.protocol,
      base_url: resolved.base_url,
      api_key: resolved.api_key,
      extra_env: JSON.stringify(resolved.extra_env_obj),
      headers_json: JSON.stringify(resolved.headers_obj),
      env_overrides_json: JSON.stringify(resolved.env_overrides_obj),
      role_models_json: JSON.stringify(resolved.role_models_obj),
      options_json: '{}',
      notes: resolved.notes,
    };

    if (existingProvider) {
      db.updateProvider(existingProvider.id, payload);
      updated++;
      if (entry.set_active && !existingProvider.is_active) {
        db.activateProvider(existingProvider.id);
        db.setDefaultProviderId(existingProvider.id);
        activated++;
      }
    } else {
      const created_provider = db.createProvider(payload);
      created++;
      if (entry.set_active) {
        db.activateProvider(created_provider.id);
        db.setDefaultProviderId(created_provider.id);
        activated++;
      }
    }
  }

  if (created || updated || activated) {
    console.log(`[seed-providers] created=${created} updated=${updated} activated=${activated} (overwrite=${overwrite})`);
  }
}
