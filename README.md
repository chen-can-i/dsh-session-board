# dsh-session-board

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-22%20%7C%2024-brightgreen.svg)](package.json)
[![smoke](https://github.com/chen-can-i/dsh-session-board/actions/workflows/smoke.yml/badge.svg)](https://github.com/chen-can-i/dsh-session-board/actions/workflows/smoke.yml)

> 会话太多，记不清哪个还在跑、哪个在等你确认？给 DSH 加一个能一眼看完的会话看板。

在会话界面里多加一个 **「会话总览」View 标签页**（与 Chat / Trajectory 平级）：
按工作区分组列出全部会话，显示运行状态与统计，可搜索过滤，点一行即跳到那个会话。

只读展示 + 跳转，不改会话、不联网、不写文件。

---

## 它长什么样

```
┌ 会话总览 ──────────────────────────────────  [刷新] ┐
│ 4 个会话，按最近活动排序                            │
│ ( 4 会话 ) ( 1 运行中 ) ( 1 待交互 ) ( 1 有未读 )   │
│ [ 搜索标题、会话 ID、工作目录…            ]          │
│                                                     │
│ 交易往来项目                              2         │
│  ● 重构退单流程        5 分钟前          [运行中]   │
│  ● 第二会话            2 小时前          [待交互]   │
│                                                     │
│ scratch                                   1         │
│  ● 子代理输出          3 天前 · 子代理              │
│                                                     │
│ 未归入工作区                              1         │
│  ● 未归区会话          1 天前 · 空白会话  [有未读]   │
└─────────────────────────────────────────────────────┘
```

- **分组**：`workspaces.list` 的 `items[].sessionIds` 是归属的权威映射；没有工作区归属但
  有 `cwd` 的按目录最后一段分组；两者都没有就落到「未归入工作区」。
- **状态点**：绿 = 运行中，橙 = 等待你确认，蓝 = 有未读完成，灰 = 空闲。
- **统计条**：总数 / 运行中 / 待交互 / 有未读，实时跟随。
- **搜索**：标题、会话 ID、工作目录、工作区标题任一命中；`Esc` 清空。
- **跳转**：点一行调 `uiWorkspace.openSession(id)`（这是 ui-workspace 的公开入口，
  它会同步换掉自己持有的 mainView reference）。只有在该服务缺失时才退回
  `sessions.retain(id, { source: "mainView" })`。

---

## 安装

### 打包

```powershell
cd dsh-dev\dsh-session-board
npm pack
```

产物是 `dsh-session-board-0.1.0.tgz`。

### 装进当前 profile

用 Plugin Manager 安装这个 tgz（绝对路径）：

```
plugin_manager install_bundle target=<绝对路径>\dsh-session-board-0.1.0.tgz
```

装好后重载页面即可在会话界面看到「会话总览」标签页。卸载同样走 Plugin Manager。

> **改代码后重装**：同一版本号会被拒绝（`already-installed`）。两种做法：
> 先 `remove_bundle`（target 是包名）再 `install_bundle`，或者把 `package.json` 的
> `version` 提到 0.1.2 再打包安装。
>
> 不用手动改 profile 的配置文件。`cordis.patch.yml` 只是组合包补丁，声明
> 「把本插件作为一条 loader 行插入」；它的**顶层必须是 patch 条目数组**
> （`- insert:` 打头），写成 `insert:` 映射会被拒绝：
> `must be a top-level YAML array of loader patch entries`。

---

## 实现要点（给别人改代码时省时间）

| 事项 | 结论 |
| --- | --- |
| 注册 View | `ctx.slots.register({ name: "conversation.view", id, order, label }, Component)`，用 `ctx.slots.inject("conversation.view", () => …)` 包一层等 declaration epoch |
| 标签页从哪来 | 会话界面遍历 `slots.entries("conversation.view")` 自动生成 tab；**不需要** `ctx.uiConversation.views.register`（那只用于注册 View Definition，纯 UI 视图不需要） |
| 会话列表 | 标准 prop `useSessions(selector)` → `{ ids, byId, phase }`，每行 `{ id, title?, displayTitle, running, blank, updatedAt, cwd?, parentId?, origin?, retainedBy, formatStatus }` |
| 运行状态 | 标准 prop `useSessionStatus(selector)` → `Map<sessionId, { running, pendingInteraction, completionUnread }>`；条目可能不存在，要用列表行的 `running` 兜底 |
| 工作区 | 标准 prop `useWorkspaces(selector)` → `{ phase, items: [{ workspaceId, path, title, sessionIds }] }` |
| 当前会话 | plain prop `sessionId`（用于高亮当前行） |
| 其它服务 | `ctx.get("sessions")` / `ctx.get("uiWorkspace")`，缺失返回 `undefined`，不抛异常（`reflect.get` 不受 inject 约束） |
| **必须声明 inject** | `ctx.slots` 这类服务属性只有写进 `exports.inject` 才可读，本插件是 `exports.inject = ["slots"]`；漏了会在加载时抛 `cannot get property "slots" without inject` |
| 样式 | `ctx.effect(() => installStyles(), …)` 幂等注入一段 `<style data-plugin-css="…">`，颜色全走 `var(--dsw-alias-*, fallback)`，深色模式自动跟随 |

宿主半（`lib/index.js`）是 no-op，只提供一个合法的 cordis 插件让 loader 行能挂载。

---

## 测试

```powershell
npm test
```

`test/smoke.mjs` 不需要浏览器：桩掉 `__ModuleLoader__` / React / `document` / `ctx`，
验证 slot 注册形状、面板渲染文本、分组与搜索、统计与相对时间，共 46 项检查。

---

## 已知边界

- **只读**：不改标题、不归档、不删除会话；需要这些能力要另开写操作（要走
  `sessions.delete` 等宿主 API，并处理确认与错误）。
- **列表本身来自宿主**：搜索是前端过滤已加载的快照，不是宿主的
  `sessions.search(query)`；如果要全量检索（含正文），应改成基于该 API 的异步搜索。
- **相对时间每 30 秒刷新一次**，不依赖宿主事件。
- **跳转不新开页面**：它切换当前会话视图（`mainView`），历史里的其它会话仍按宿主的
  retain 规则保留。
