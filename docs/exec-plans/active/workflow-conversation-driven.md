# 对话驱动工作流可视化

## 目标
用户在 CodePilot 对话中说"帮我制作漫剧/PPT/小红书/重构代码"，系统自动：
1. 检测技能类型
2. 生成 Workflow 模板并推送到 Monitor
3. 随着 Claude 执行任务，实时更新 Monitor 中的阶段进度、事件、资产状态

## 文件变更

### 新建
- `src/lib/workflow-templates.ts` — 技能关键词检测 + Workflow 模板生成器

### 修改
- `src/app/api/chat/route.ts` — 消息发送前检测技能 → 生成工作流 → 推送 API → 注入系统提示
- `src/lib/claude-client.ts` — 文本流中解析 `<!--wf:...-->` 标记，PostToolUse 添加事件
- `src/app/api/workflow-status/route.ts` — 已有，无需大改

### 依赖
- situation-monitor 侧无需改动（已有 postMessage 监听 + workflowStore）
- CodePilot `workflow-monitor/page.tsx` 已有轮询 + iframe 推送

## 数据流
```
用户输入 "帮我制作漫剧"
  → chat/route.ts: detectSkill("帮我制作漫剧") → "comic"
  → workflow-templates.ts: generateWorkflow("comic") → Workflow JSON
  → POST /api/workflow-status { type: "full", workflow }
  → Monitor iframe 轮询获取 → 显示所有阶段 (pending)
  → streamClaude() 开始
  → Claude 输出文本含 <!--wf:p1:in_progress:30-->
  → collectStreamResponse 解析标记
  → POST /api/workflow-status { type: "phase_update", ... }
  → Monitor 实时更新
```

## 技能检测关键词
- comic/漫剧: 漫剧, 漫画, comic, 动漫
- ppt: PPT, 演示文稿, 幻灯片, presentation, slide
- xiaohongshu: 小红书, 图文, 种草
- refactor: 重构, refactor, 迁移, migration

## 系统提示注入
当检测到技能时，追加：
```
你正在执行一个工作流任务。请在完成每个阶段时输出进度标记：
<!--wf:PHASE_ID:STATUS:PROGRESS-->
例如: <!--wf:p1:in_progress:50--> 或 <!--wf:p1:completed:100-->
```

## 状态: IN PROGRESS
