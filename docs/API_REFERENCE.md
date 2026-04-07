# CodePilot 后端 API 参考文档

> 基于 Next.js App Router，共 **85 个路由**，覆盖 Chat、Session、Provider、Workspace、Skills、Media、Bridge、Settings 等模块。

---

## 目录

1. [Chat 核心对话](#1-chat-核心对话)
2. [Session 会话管理](#2-session-会话管理)
3. [Provider API 供应商](#3-provider-api-供应商)
4. [Files 文件操作](#4-files-文件操作)
5. [Skills 技能管理](#5-skills-技能管理)
6. [Skills Marketplace 技能市场](#6-skills-marketplace-技能市场)
7. [Plugins / MCP 插件管理](#7-plugins--mcp-插件管理)
8. [Media 图片生成](#8-media-图片生成)
9. [Media Jobs 批量任务](#9-media-jobs-批量任务)
10. [Workspace 工作区](#10-workspace-工作区)
11. [Bridge 跨平台桥接](#11-bridge-跨平台桥接)
12. [Settings 设置](#12-settings-设置)
13. [Tasks 任务管理](#13-tasks-任务管理)
14. [其他](#14-其他)

---

## 1. Chat 核心对话

### `POST /api/chat` (SSE 流式)

核心对话接口，通过 Claude Agent SDK 调用本地 Claude Code CLI，返回 SSE 流。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_id` | string | 是 | 会话 ID |
| `content` | string | 是 | 用户消息 |
| `model` | string | 否 | 模型名称 |
| `mode` | `'code'` \| `'plan'` \| `'ask'` | 否 | 权限模式 |
| `files` | FileAttachment[] | 否 | 附件 |
| `provider_id` | string | 否 | 指定供应商 |
| `thinking` | object | 否 | 思考模式配置 |
| `effort` | string | 否 | 推理努力等级 |
| `systemPromptAppend` | string | 否 | 追加系统提示词 |
| `toolTimeout` | number | 否 | 工具超时(ms) |
| `enableFileCheckpointing` | boolean | 否 | 启用文件检查点 |

**响应**: `text/event-stream`，事件类型包括 `text`、`tool_use`、`permission_request`、`error`、`done` 等。

---

### `POST /api/chat/messages`

直接保存消息到数据库（不触发模型），用于图片生成模式等场景。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_id` | string | 是 | 会话 ID |
| `role` | `'user'` \| `'assistant'` | 是 | 角色 |
| `content` | string | 是 | 消息内容 |
| `token_usage` | string | 否 | Token 用量 |

**响应**: `{ message: Message }`

---

### `PUT /api/chat/messages`

更新已有消息内容。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message_id` | string | 是 | 消息 ID |
| `content` | string | 是 | 新内容 |
| `session_id` | string | 否 | 用于回退查找 |
| `prompt_hint` | string | 否 | 用于回退匹配 |

---

### `POST /api/chat/interrupt`

中断当前正在进行的对话流。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | 会话 ID |

**响应**: `{ interrupted: boolean }`

---

### `POST /api/chat/rewind`

回退文件变更（撤销某次对话中的文件修改）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | 会话 ID |
| `userMessageId` | string | 是 | 要回退的消息 ID |
| `dryRun` | boolean | 否 | 仅预览不执行 |

---

### `POST /api/chat/permission`

响应权限请求（允许/拒绝工具调用）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `permissionRequestId` | string | 是 | 请求 ID |
| `decision` | object | 是 | `{ behavior: 'allow' \| 'deny', message?, updatedInput? }` |

---

### `POST /api/chat/mode`

切换会话的权限模式。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | 会话 ID |
| `mode` | `'code'` \| `'plan'` | 是 | 目标模式 |

---

### `POST /api/chat/model`

切换会话使用的模型。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | 会话 ID |
| `model` | string | 是 | 模型 ID |

---

### `POST /api/chat/structured`

结构化输出查询（JSON Schema 模式）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 提示词 |
| `outputFormat` | `{ type: 'json_schema', schema: object }` | 是 | 输出格式 |
| `options` | `{ cwd?, model? }` | 否 | 可选配置 |

**响应**: `{ result: unknown }`

---

## 2. Session 会话管理

### `GET /api/chat/sessions`

获取所有会话列表。

**响应**: `{ sessions: Session[] }`

---

### `POST /api/chat/sessions`

创建新会话。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `working_directory` | string | 是 | 工作目录 |
| `title` | string | 否 | 会话标题 |
| `model` | string | 否 | 模型 |
| `mode` | string | 否 | 模式 |
| `provider_id` | string | 否 | 供应商 ID |
| `permission_profile` | string | 否 | 权限配置 |

---

### `GET /api/chat/sessions/[id]`

获取单个会话详情。

---

### `PATCH /api/chat/sessions/[id]`

更新会话属性（标题、工作目录、模式、模型、provider 等）。特殊字段 `clear_messages: true` 可清空消息。

---

### `DELETE /api/chat/sessions/[id]`

删除会话。

---

### `GET /api/chat/sessions/[id]/messages`

分页获取会话消息。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `limit` | number | 30 | 每页条数 |
| `before` | number | - | 分页游标 (row ID) |

**响应**: `{ messages: Message[], hasMore: boolean }`

---

### `GET /api/claude-sessions`

列出可导入的 Claude Code SDK 会话。

---

### `POST /api/claude-sessions/import`

导入 SDK 会话到 CodePilot。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | SDK 会话 ID |

---

## 3. Provider API 供应商

### `GET /api/providers`

列出所有已配置的供应商（API Key 脱敏）。

**响应**: `{ providers: ApiProvider[], env_detected: Record<string, string>, default_provider_id: string }`

---

### `POST /api/providers`

创建新供应商。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 供应商名称 |
| `provider_type` | string | 否 | 类型 (anthropic/openai/bedrock 等) |
| `base_url` | string | 否 | API 地址 |
| `api_key` | string | 否 | API Key |
| `role_models_json` | string | 否 | 角色模型映射 |
| `env_overrides_json` | string | 否 | 环境变量覆盖 |

---

### `GET /api/providers/[id]`

获取单个供应商详情。

### `PUT /api/providers/[id]`

更新供应商配置。

### `DELETE /api/providers/[id]`

删除供应商。

---

### `POST /api/providers/[id]/activate`

激活/停用供应商。

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `active` | boolean | true | 是否激活 |

---

### `GET /api/providers/models`

获取可用模型列表（按供应商分组，含上下文窗口和能力信息）。

**响应**: `{ groups: ProviderModelGroup[], default_provider_id: string }`

---

## 4. Files 文件操作

### `GET /api/files`

获取目录树。

| 参数 | 类型 | 说明 |
|------|------|------|
| `dir` | string | 目标目录 |
| `baseDir` | string | 基础目录 |
| `depth` | number | 递归深度 (默认 3) |

---

### `GET /api/files/raw`

获取文件原始内容，返回对应 MIME 类型。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |

---

### `GET /api/files/preview`

读取文件预览（前 N 行）。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `path` | string | 必填 | 文件路径 |
| `maxLines` | number | 200 | 最大行数 |

---

### `GET /api/files/browse`

目录浏览（用于文件夹选择器），仅返回子目录。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `dir` | string | HOME | 目录路径 |

**响应**: `{ current, parent, directories: [{name, path}], drives }`

---

### `POST /api/files/open`

在系统文件管理器中打开文件/文件夹。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |

---

### `GET /api/uploads`

提供 `.codepilot-media/` `.codepilot-uploads/` `.codepilot-images/` 目录下的文件服务。有路径安全检查，防止目录遍历。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |

---

## 5. Skills 技能管理

### `GET /api/skills`

列出所有可用技能（全局、项目、已安装、SDK 命令）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `cwd` | string | 自定义工作目录 |

**扫描路径**: `.claude/commands/`, `.claude/skills/`, `~/.agents/skills/`, `~/.claude/skills/`

---

### `POST /api/skills`

创建新技能文件。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 技能名称 |
| `content` | string | 是 | 内容 |
| `scope` | `'global'` \| `'project'` | 是 | 作用域 |

---

### `GET /api/skills/[name]`

读取技能内容（解析 YAML front matter）。

### `PUT /api/skills/[name]`

更新技能内容。

### `DELETE /api/skills/[name]`

删除技能文件。

---

### `POST /api/skills/search`

AI 语义搜索匹配技能。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索关键词 |
| `skills` | SkillInfo[] | 是 | 可选技能列表 |

---

## 6. Skills Marketplace 技能市场

数据源: GitHub 仓库 `intelli-train-ai/skills`（本地 clone 缓存）。

### `GET /api/skills/marketplace/search`

搜索市场技能。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `q` | string | "" | 搜索关键词 |
| `limit` | number | 20 | 结果数量 |

**响应**: `{ skills: MarketplaceSkill[] }`

---

### `GET /api/skills/marketplace/readme`

获取技能的 SKILL.md 内容。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `skillId` | string | 是 | 技能 ID |

---

### `POST /api/skills/marketplace/install` (SSE 流式)

安装技能，流式输出安装日志。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source` | string | 是 | 如 `intelli-train-ai/skills/pdf-converter` |
| `global` | boolean | 否 | 全局安装 (默认 true) |

执行命令: `npx skills add <source> -y --agent claude-code`

---

### `POST /api/skills/marketplace/remove` (SSE 流式)

卸载技能，流式输出日志。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `skill` | string | 是 | 技能名称 |
| `global` | boolean | 否 | 全局卸载 (默认 true) |

---

## 7. Plugins / MCP 插件管理

### `GET /api/plugins`

发现所有可用插件/自定义命令。

**响应**: `{ plugins: SkillInfo[] }`

---

### `GET /api/plugins/[id]`

获取插件详情。

### `PUT /api/plugins/[id]`

启用/禁用插件。

---

### `GET /api/plugins/mcp`

读取 MCP 服务器配置（来自 `~/.claude/settings.json`）。

**响应**: `{ mcpServers: Record<string, MCPServerConfig> }`

---

### `POST /api/plugins/mcp`

添加 MCP 服务器。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 服务器名称 |
| `server` | MCPServerConfig | 是 | 配置 |

---

### `PUT /api/plugins/mcp`

批量更新 MCP 配置。

### `DELETE /api/plugins/mcp/[name]`

删除 MCP 服务器。

---

### `GET /api/plugins/mcp/status`

获取 MCP 服务器运行状态。

| 参数 | 类型 | 说明 |
|------|------|------|
| `sessionId` | string | 传入则刷新缓存 |

---

### `POST /api/plugins/mcp/reconnect`

重连指定 MCP 服务器。

### `POST /api/plugins/mcp/toggle`

启用/禁用指定 MCP 服务器。

---

## 8. Media 图片生成

### `POST /api/media/generate`

生成单张图片（使用 Gemini API）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 图片描述 |
| `model` | string | 否 | 模型名称 |
| `aspectRatio` | string | 否 | 宽高比 (`1:1`, `16:9` 等) |
| `imageSize` | string | 否 | 图片尺寸 (`1K` 等) |
| `referenceImages` | array | 否 | 参考图片 `[{mimeType, data}]` |
| `sessionId` | string | 否 | 关联会话 |

**响应**: `{ id, text, images, model, imageSize, elapsedMs }`
**超时**: 300 秒

---

### `GET /api/media/gallery`

图片库浏览。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `tags` | string | - | 逗号分隔的标签 |
| `dateFrom` | string | - | ISO 日期 |
| `dateTo` | string | - | ISO 日期 |
| `favoritesOnly` | `'1'` | - | 仅收藏 |
| `sort` | `'newest'` \| `'oldest'` | newest | 排序 |
| `limit` | number | 50 | 分页 |
| `offset` | number | 0 | 偏移 |

**响应**: `{ items: [], total: number }`

---

### `GET /api/media/serve`

图片文件服务（限 `.codepilot-media/` 目录）。

---

### `GET /api/media/[id]` / `DELETE /api/media/[id]`

获取/删除单个图片生成记录。

### `PUT /api/media/[id]/favorite`

切换收藏状态。

### `PUT /api/media/[id]/tags`

更新标签。

### `GET /api/media/tags` / `POST /api/media/tags`

列出/创建标签。

### `DELETE /api/media/tags/[id]`

删除标签。

---

## 9. Media Jobs 批量任务

### `GET /api/media/jobs` / `POST /api/media/jobs`

列出/创建批量图片生成任务。

---

### `POST /api/media/jobs/plan` (SSE 流式)

AI 规划图片生成方案。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `stylePrompt` | string | 是 | 风格描述 |
| `docContent` | string | 否 | 文档内容 |
| `docPaths` | string[] | 否 | 文件路径 |
| `count` | number | 否 | 图片数量 |

---

### `POST /api/media/jobs/[id]/start`

启动任务。

### `POST /api/media/jobs/[id]/pause`

暂停任务。

### `POST /api/media/jobs/[id]/resume`

恢复任务。

### `POST /api/media/jobs/[id]/cancel`

取消任务。

### `GET /api/media/jobs/[id]/progress` (SSE 流式)

实时进度流（心跳 15 秒）。事件: `snapshot`, `item_completed`, `item_failed`, `job_completed`, `done`。

### `PUT /api/media/jobs/[id]/items`

批量编辑任务项。

### `POST /api/media/jobs/[id]/sync-context`

同步任务结果到对话上下文。

---

## 10. Workspace 工作区

### `GET /api/workspace/onboarding`

获取引导问题列表（13 题）。

### `POST /api/workspace/onboarding`

提交引导问卷，LLM 生成 `soul.md`、`user.md`、`claude.md`、`memory.md`、`config.json`。

---

### `GET /api/workspace/checkin` / `POST /api/workspace/checkin`

每日签到问卷（3 题），生成每日记忆、更新 `memory.md`。

---

### `GET /api/workspace/inspect`

检查工作区路径状态。

**响应**: `{ exists, isDirectory, readable, writable, hasAssistantData, workspaceStatus }`

---

### `POST /api/workspace/organize`

工作区整理（捕获、分类、移动、归档、建议演进）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `action` | `'capture'` \| `'classify'` \| `'move'` \| `'archive'` \| `'suggest-evolution'` | 操作类型 |

---

### `GET /api/workspace/latest-session`

获取指定工作目录的最近会话。

### `POST /api/workspace/session`

创建或复用工作区会话。

### `GET /api/workspace/index` / `POST /api/workspace/index`

工作区搜索索引管理。

### `GET /api/workspace/search`

搜索工作区。

### `POST /api/workspace/docs`

生成工作区文档。

### `POST /api/workspace/hook-triggered`

记录触发 hook 的会话。

---

## 11. Bridge 跨平台桥接

### `GET /api/bridge` / `POST /api/bridge`

桥接状态查看 / 启动 (`start`) / 停止 (`stop`) / 自动启动 (`auto-start`)。

### `GET /api/bridge/settings` / `PUT /api/bridge/settings`

桥接统一设置（涵盖 Telegram、Feishu、Discord、QQ）。

### `GET /api/bridge/channels`

列出频道绑定。

---

## 12. Settings 设置

### `GET /api/settings` / `PUT /api/settings`

Claude Code 用户级设置（`~/.claude/settings.json`）。

---

### `GET /api/settings/app` / `PUT /api/settings/app`

CodePilot 应用设置（SQLite 存储）。

允许的 key: `anthropic_auth_token`(脱敏), `anthropic_base_url`, `dangerously_skip_permissions`, `locale`, `thinking_mode`

---

### `GET /api/settings/workspace` / `PUT /api/settings/workspace`

工作区路径配置与验证。

---

### 平台集成设置

| 路由 | 说明 |
|------|------|
| `GET/PUT /api/settings/telegram` | Telegram 通知设置 |
| `POST /api/settings/telegram/verify` | 验证 Token / 检测 Chat ID / 注册命令 |
| `GET/PUT /api/settings/feishu` | 飞书机器人设置 |
| `POST /api/settings/feishu/verify` | 验证飞书凭据 |
| `GET/PUT /api/settings/discord` | Discord 机器人设置 |
| `POST /api/settings/discord/verify` | 验证 Discord Token |
| `GET/PUT /api/settings/qq` | QQ 机器人设置 |
| `POST /api/settings/qq/verify` | 验证 QQ 凭据 |

所有 `verify` 接口返回: `{ verified: boolean, botName?, error? }`

---

## 13. Tasks 任务管理

### `GET /api/tasks`

获取会话的任务列表。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_id` | string | 是 | 会话 ID |

---

### `POST /api/tasks`

创建任务。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_id` | string | 是 | 会话 ID |
| `title` | string | 是 | 任务标题 |
| `description` | string | 否 | 描述 |

---

### `PUT /api/tasks`

批量同步 SDK 任务。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_id` | string | 是 | 会话 ID |
| `todos` | array | 是 | `[{id, content, status, activeForm?}]` |

---

### `PATCH /api/tasks/[id]`

更新单个任务。

### `DELETE /api/tasks/[id]`

删除任务。

---

## 14. 其他

### `GET /api/health`

健康检查。

**响应**: `{ status: 'ok' }`

---

### `GET /api/claude-status`

检查 Claude Code CLI 安装状态。

**响应**: `{ connected: boolean, version: string | null }`

---

### `GET /api/sdk/account`

获取 SDK 账户信息和能力缓存。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `providerId` | string | `'env'` | 供应商 ID |

---

### `GET /api/app/updates`

检查应用更新（查询 GitHub Releases）。

**响应**: `{ latestVersion, currentVersion, updateAvailable, releaseName, releaseNotes, publishedAt, releaseUrl }`

---

### `GET /api/usage/stats`

Token 用量统计。

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `days` | number | 30 | 统计天数 (1-365) |

---

## 架构要点

- **数据库**: SQLite (better-sqlite3)，存储会话、消息、设置、供应商、任务、媒体等
- **认证**: 无内置认证，依赖本地运行环境
- **流式响应**: 6 个 SSE 端点 (chat、media plan、media progress、skill install/remove)
- **安全**: 文件服务限制在白名单目录，API Key 脱敏返回，路径遍历防护
- **外部依赖**: Claude Agent SDK、Gemini API (图片生成)、GitHub API (技能市场)、Telegram/Discord/飞书/QQ API (桥接)
