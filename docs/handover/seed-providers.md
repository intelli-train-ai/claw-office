# Pre-seed vendor providers (Docker / headless 部署)

> 产品思考：本机桌面版用户在设置页里手动连接 provider 没问题；但容器化/多实例部署时，每次冷启动都要进 UI 点一遍很麻烦。这里给出一个 startup-time 注入机制，把"目录中已有的 preset + API Key"以环境变量/文件方式打进 DB。

适用场景：
- Docker / Kubernetes 部署需要**首次启动即可用**的 provider 配置
- CI / 内部预发环境需要把测试 key 注入到固定 provider
- 多实例共享同一份 vendor 配置基线

## 工作机制

`src/instrumentation.ts` 在服务器进程启动时调用 `seedProvidersFromEnv()`（`src/lib/seed-providers.ts`）：
1. 读取 `SEED_PROVIDERS_JSON` 或 `SEED_PROVIDERS_FILE`
2. 每条 entry 通过 `preset` 关联 `VENDOR_PRESETS` —— base_url / protocol / env / role models 都从目录里继承
3. 用 `name` 做幂等匹配 —— 已存在则跳过；`SEED_PROVIDERS_OVERWRITE=1` 时刷新 base_url / api_key / env / 角色映射
4. `set_active: true` 把该 provider 设为默认 active provider

## 环境变量

| 变量 | 说明 |
|---|---|
| `SEED_PROVIDERS_JSON` | 内联 JSON 数组（适合少量 provider） |
| `SEED_PROVIDERS_FILE` | JSON 文件路径（推荐多 provider 时使用，便于 mount） |
| `SEED_PROVIDERS_OVERWRITE` | `1` 时每次启动覆盖现有同名 provider；默认 `0`（首次创建后只跳过） |

## Entry 字段

```ts
interface SeedEntry {
  preset?: string;                       // VENDOR_PRESETS 的 key (deepseek-anthropic / ucloud-claude / glm-cn ...)
  name?: string;                         // 显示名（默认取 preset.name）
  api_key?: string;                      // API Key / Auth Token —— preset 的 authStyle 决定塞到 ANTHROPIC_API_KEY 还是 ANTHROPIC_AUTH_TOKEN
  base_url?: string;                     // 覆盖 preset.baseUrl
  protocol?: string;                     // 覆盖 preset.protocol
  env_overrides?: Record<string, string>; // 合并到 preset.defaultEnvOverrides 之上
  headers?: Record<string, string>;
  role_models?: { default?, sonnet?, opus?, haiku?, reasoning?, small? };
  set_active?: boolean;                  // 设为默认 active provider
  notes?: string;
}
```

## 三个示例

### 示例 1：内联 JSON（docker-compose.yml）

```yaml
environment:
  - SEED_PROVIDERS_JSON=[{"preset":"deepseek-anthropic","name":"DeepSeek V4 Pro","api_key":"sk-1863...","set_active":true},{"preset":"ucloud-claude","name":"UCloud Claude","api_key":"sk-..."}]
```

### 示例 2：mount 一个文件

`./providers.json`:
```json
[
  {
    "preset": "deepseek-anthropic",
    "name": "DeepSeek V4 Pro",
    "api_key": "sk-1863f0102f7a4e68bf5e00b60a39f339",
    "set_active": true
  },
  {
    "preset": "ucloud-claude",
    "name": "UCloud Claude",
    "api_key": "sk-xxxxx"
  },
  {
    "preset": "glm-cn",
    "name": "GLM (CN)",
    "api_key": "..."
  }
]
```

`docker-compose.yml`:
```yaml
volumes:
  - ./providers.json:/etc/safeclaw/providers.json:ro
environment:
  - SEED_PROVIDERS_FILE=/etc/safeclaw/providers.json
```

### 示例 3：纯自定义（不依赖 preset）

```json
[
  {
    "name": "Internal Gateway",
    "protocol": "anthropic",
    "base_url": "https://gateway.intelli-train.ai/anthropic",
    "api_key": "...",
    "env_overrides": { "ANTHROPIC_AUTH_TOKEN": "...", "API_TIMEOUT_MS": "3000000" },
    "role_models": { "default": "claude-sonnet-4-5-20250929" }
  }
]
```

## 安全提示

- `SEED_PROVIDERS_JSON` 中的 key 会出现在 `docker inspect` / `ps -e` 输出里 —— 生产环境优先用 `SEED_PROVIDERS_FILE` 配合 secrets / mounted volume
- `SEED_PROVIDERS_OVERWRITE=1` 会**强制刷新**已有 provider 的 key 和 env —— 适合"配置即代码"的场景；如果用户在 UI 里改过设置又不想被覆盖，保持默认 `0`
- 失败时 instrumentation 不会阻塞启动，仅打日志 `[seed-providers] ...`
