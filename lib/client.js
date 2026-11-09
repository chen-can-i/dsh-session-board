window.__ModuleLoader__.load({
	id: "dsh-session-board",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		/* ------------------------------ 常量 ------------------------------ */

		const NAME = "dsh-session-board";
		const VIEW_ID = "session-board";
		const VIEW_LABEL = "会话总览";
		const VIEW_ORDER = 20;
		const STYLE_ID = "dsh-session-board/board.css";

		/** 数据还没到时使用的空快照，形状与标准源保持一致。 */
		const EMPTY_LIST = { ids: [], byId: {}, phase: "pending" };
		const EMPTY_STATUS = new Map();
		const EMPTY_WORKSPACES = { phase: "pending", items: [] };

		const useEmptyList = () => EMPTY_LIST;
		const useEmptyStatus = () => EMPTY_STATUS;
		const useEmptyWorkspaces = () => EMPTY_WORKSPACES;

		const STATUS_LABEL = {
			running: "运行中",
			pending: "待交互",
			unread: "有未读",
			idle: ""
		};

		/** apply 时捕获的 client ctx，供面板里的导航动作使用。 */
		let pluginCtx = null;

		/* ---------------------------- 纯函数 ------------------------------ */

		/**
		 * 一行会话的展示标题：优先用户标题，其次投影标题，最后会话 id。
		 * @param {object} row - sessions.list 的一行。
		 * @returns {string}
		 */
		function sessionTitle(row) {
			if (typeof row.title === "string" && row.title.trim() !== "") return row.title.trim();
			if (typeof row.displayTitle === "string" && row.displayTitle.trim() !== "") {
				return row.displayTitle.trim();
			}
			return typeof row.id === "string" ? row.id : "";
		}

		/**
		 * 是不是子代理子会话。
		 * @param {object} row
		 * @returns {boolean}
		 */
		function isSubagent(row) {
			return row.origin === "subagent" || typeof row.parentId === "string";
		}

		/**
		 * 取某会话的运行状态条目；状态表缺失时返回 undefined。
		 * @param {Map<string, object>|undefined} statuses
		 * @param {string} sessionId
		 * @returns {object|undefined}
		 */
		function statusEntry(statuses, sessionId) {
			if (statuses === undefined || statuses === null || typeof statuses.get !== "function") return undefined;
			return statuses.get(sessionId);
		}

		/**
		 * 把状态条目归成四种展示档位，优先级 running > pending > unread > idle。
		 * @param {object|undefined} entry
		 * @param {object} row - 列表行（状态表缺 so 时用它的 running 兜底）。
		 * @returns {"running"|"pending"|"unread"|"idle"}
		 */
		function statusKind(entry, row) {
			const running = entry === undefined ? row?.running === true : entry.running === true;
			if (running) return "running";
			if (entry !== undefined && entry.pendingInteraction !== undefined && entry.pendingInteraction !== null) {
				return "pending";
			}
			if (entry !== undefined && entry.completionUnread === true) return "unread";
			return "idle";
		}

		/**
		 * 相对时间文案（只用于展示，不参与任何判断）。
		 * @param {number} at - 毫秒时间戳。
		 * @param {number} now - 当前毫秒时间戳。
		 * @returns {string}
		 */
		function relativeTime(at, now) {
			if (!Number.isFinite(at) || at <= 0) return "无时间";
			const diff = Math.max(0, now - at);
			const minute = 60000;
			if (diff < minute) return "刚刚";
			if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
			if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
			if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
			try {
				return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(at));
			} catch (error) {
				return new Date(at).toISOString().slice(0, 10);
			}
		}

		/**
		 * 取路径最后一段，用作没有工作区标题时的分组名。
		 * @param {string} path
		 * @returns {string}
		 */
		function baseName(path) {
			const normalized = path.replace(/[\\/]+$/, "");
			const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
			const tail = index >= 0 ? normalized.slice(index + 1) : normalized;
			return tail === "" ? normalized : tail;
		}

		/**
		 * 建 workspaceId → 工作区条目 的映射；sessionIds 是归属的权威来源。
		 * @param {{items?: object[]}|undefined} workspaceState
		 * @returns {Map<string, object>}
		 */
		function workspaceBySession(workspaceState) {
			const map = new Map();
			const items = workspaceState && Array.isArray(workspaceState.items) ? workspaceState.items : [];
			for (const workspace of items) {
				const sessionIds = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
				for (const sessionId of sessionIds) map.set(sessionId, workspace);
			}
			return map;
		}

		/**
		 * 搜索匹配：标题、id、工作目录、工作区标题任一命中即可。
		 * @param {object} row
		 * @param {string} needle - 已转小写并 trim 的查询串。
		 * @param {object|undefined} workspace
		 * @returns {boolean}
		 */
		function matchesQuery(row, needle, workspace) {
			if (needle === "") return true;
			const fields = [
				sessionTitle(row),
				typeof row.id === "string" ? row.id : "",
				typeof row.cwd === "string" ? row.cwd : "",
				workspace && typeof workspace.title === "string" ? workspace.title : ""
			];
			for (const field of fields) {
				if (field.toLowerCase().includes(needle)) return true;
			}
			return false;
		}

		/**
		 * 把会话行按工作区分组，并按最近活动排序。
		 * @param {{ids?: string[], byId?: object}} list - sessions.list 快照。
		 * @param {{items?: object[]}} workspaceState - workspaces.list 快照。
		 * @param {string} query - 原始查询串（内部会 trim + 转小写）。
		 * @returns {{key: string, label: string, sortAt: number, rows: object[]}[]}
		 */
		function buildGroups(list, workspaceState, query) {
			const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
			const byId = list && list.byId ? list.byId : {};
			const ids = list && Array.isArray(list.ids) ? list.ids : [];
			const owner = workspaceBySession(workspaceState);
			const groups = new Map();
			for (const id of ids) {
				const row = byId[id];
				if (row === undefined || row === null) continue;
				const workspace = owner.get(id);
				if (!matchesQuery(row, needle, workspace)) continue;
				const workspaceId = workspace && typeof workspace.workspaceId === "string" ? workspace.workspaceId : "";
				const path = typeof row.cwd === "string" ? row.cwd : "";
				const key = workspaceId !== "" ? `workspace:${workspaceId}` : path !== "" ? `path:${path}` : "unassigned";
				const label =
					workspace && typeof workspace.title === "string" && workspace.title.trim() !== ""
						? workspace.title.trim()
						: path !== ""
							? baseName(path)
							: "未归入工作区";
				let group = groups.get(key);
				if (group === undefined) {
					group = { key, label, sortAt: -Infinity, rows: [] };
					groups.set(key, group);
				}
				group.rows.push(row);
				const at = Number.isFinite(row.updatedAt) ? row.updatedAt : 0;
				if (at > group.sortAt) group.sortAt = at;
			}
			const result = [...groups.values()];
			for (const group of result) group.rows.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
			result.sort((left, right) => {
				if (left.key === "unassigned") return 1;
				if (right.key === "unassigned") return -1;
				return right.sortAt - left.sortAt;
			});
			return result;
		}

		/**
		 * 统计面板用的四个数字。
		 * @param {{ids?: string[], byId?: object}} list
		 * @param {Map<string, object>|undefined} statuses
		 * @returns {{total: number, running: number, pending: number, unread: number, subagents: number}}
		 */
		function countTotals(list, statuses) {
			const byId = list && list.byId ? list.byId : {};
			const ids = list && Array.isArray(list.ids) ? list.ids : [];
			const totals = { total: ids.length, running: 0, pending: 0, unread: 0, subagents: 0 };
			for (const id of ids) {
				const row = byId[id];
				if (row === undefined || row === null) continue;
				if (isSubagent(row)) totals.subagents += 1;
				const entry = statusEntry(statuses, id);
				if (entry !== undefined && entry.running === true) {
					totals.running += 1;
					continue;
				}
				if (row.running === true) {
					totals.running += 1;
					continue;
				}
				if (entry !== undefined && entry.pendingInteraction !== undefined && entry.pendingInteraction !== null) {
					totals.pending += 1;
					continue;
				}
				if (entry !== undefined && entry.completionUnread === true) totals.unread += 1;
			}
			return totals;
		}

		/* ---------------------------- 导航动作 ----------------------------- */

		/**
		 * 打开某个会话。首选 ui-workspace 的公开入口（它会同步换掉自己持有的
		 * mainView reference）；只有在那个服务缺失时才退回原始 retain。
		 * @param {string} sessionId
		 * @returns {void}
		 */
		function openSession(sessionId) {
			const ctx = pluginCtx;
			if (ctx === null || typeof sessionId !== "string" || sessionId === "") return;
			const workspace = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : undefined;
			if (workspace !== undefined && workspace !== null && typeof workspace.openSession === "function") {
				try {
					workspace.openSession(sessionId);
					return;
				} catch (error) {
					console.warn(`[${NAME}] openSession 失败:`, error);
				}
			}
			const sessions = typeof ctx.get === "function" ? ctx.get("sessions") : undefined;
			if (sessions === undefined || sessions === null || typeof sessions.retain !== "function") return;
			try {
				sessions.retain(sessionId, { source: "mainView" });
			} catch (error) {
				console.warn(`[${NAME}] retain 失败:`, error);
			}
		}

		/**
		 * 让宿主重新拉一次会话列表（失败不打断界面）。
		 * @returns {void}
		 */
		function refreshList() {
			const ctx = pluginCtx;
			if (ctx === null || typeof ctx.get !== "function") return;
			const sessions = ctx.get("sessions");
			if (sessions === undefined || sessions === null || typeof sessions.refresh !== "function") return;
			try {
				const pending = sessions.refresh();
				if (pending !== undefined && pending !== null && typeof pending.catch === "function") {
					pending.catch((error) => console.warn(`[${NAME}] 刷新会话列表失败:`, error));
				}
			} catch (error) {
				console.warn(`[${NAME}] 刷新会话列表失败:`, error);
			}
		}

		/* ------------------------------ 样式 ------------------------------ */

		const BOARD_CSS = `
.sb-root{height:100%;min-height:0;overflow-y:auto;box-sizing:border-box;padding:20px 24px 72px;color:var(--dsw-alias-label-primary,#1a1a1a);font-size:13px;line-height:1.5}
.sb-inner{display:flex;flex-direction:column;gap:16px;width:100%;max-width:920px;margin:0 auto}
.sb-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px}
.sb-heading{display:flex;flex-direction:column;gap:4px;min-width:0}
.sb-title{margin:0;font-size:16px;font-weight:600;letter-spacing:.01em}
.sb-sub{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary,rgba(0,0,0,.55))}
.sb-actions{display:flex;align-items:center;gap:8px}
.sb-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:12px;padding:5px 10px;border-radius:8px;cursor:pointer}
.sb-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.sb-stats{display:flex;flex-wrap:wrap;gap:8px}
.sb-stat{display:flex;align-items:baseline;gap:6px;padding:6px 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04))}
.sb-stat-value{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
.sb-stat-label{font-size:11px;color:var(--dsw-alias-label-secondary,rgba(0,0,0,.55))}
.sb-stat[data-tone="running"] .sb-stat-value{color:#15803d}
.sb-stat[data-tone="pending"] .sb-stat-value{color:#b45309}
.sb-stat[data-tone="unread"] .sb-stat-value{color:#1d4ed8}
.sb-toolbar{display:flex;align-items:center;gap:8px}
.sb-search{flex:1 1 auto;min-width:0;box-sizing:border-box;padding:8px 11px;font:inherit;font-size:13px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit}
.sb-search:focus{outline:2px solid var(--dsw-alias-border-l4,rgba(37,99,235,.5));outline-offset:-1px}
.sb-search::placeholder{color:var(--dsw-alias-label-tertiary,rgba(0,0,0,.4))}
.sb-group{display:flex;flex-direction:column;gap:2px}
.sb-group-head{position:sticky;top:0;z-index:1;display:flex;align-items:baseline;gap:8px;padding:6px 4px;background:var(--dsw-alias-bg-base,inherit);backdrop-filter:blur(2px)}
.sb-group-title{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary,rgba(0,0,0,.6));text-transform:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-group-count{font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,rgba(0,0,0,.4))}
.sb-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.sb-row{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;border:1px solid transparent;cursor:pointer;min-width:0}
.sb-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.sb-row:focus-visible{outline:2px solid var(--dsw-alias-border-l4,rgba(37,99,235,.6));outline-offset:1px}
.sb-row[data-current="true"]{background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.08));border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.12))}
.sb-row[data-blank="true"] .sb-row-title{font-style:italic;opacity:.7}
.sb-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary,rgba(0,0,0,.28))}
.sb-row[data-status="running"] .sb-dot{background:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.16)}
.sb-row[data-status="pending"] .sb-dot{background:#d97706;box-shadow:0 0 0 3px rgba(217,119,6,.16)}
.sb-row[data-status="unread"] .sb-dot{background:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.14)}
.sb-row-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.sb-row-title{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-row-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,rgba(0,0,0,.45));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-badge{flex:none;font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid transparent}
.sb-badge[data-kind="running"]{color:#15803d;background:rgba(22,163,74,.1);border-color:rgba(22,163,74,.22)}
.sb-badge[data-kind="pending"]{color:#b45309;background:rgba(217,119,6,.1);border-color:rgba(217,119,6,.24)}
.sb-badge[data-kind="unread"]{color:#1d4ed8;background:rgba(37,99,235,.09);border-color:rgba(37,99,235,.2)}
.sb-tag{flex:none;font-size:10px;padding:1px 6px;border-radius:5px;color:var(--dsw-alias-label-tertiary,rgba(0,0,0,.5));border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1))}
.sb-empty{padding:32px 8px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,rgba(0,0,0,.45))}
`;

		/**
		 * 幂等注入样式：同一份 CSS 只挂一次，卸载时不主动移除（插件重装会替换）。
		 * @returns {void}
		 */
		function installStyles() {
			if (typeof document === "undefined" || document.head === null) return;
			const existing = document.head.querySelector(`style[data-plugin-css="${STYLE_ID}"]`);
			if (existing !== null && existing !== undefined) return;
			const style = document.createElement("style");
			style.dataset.pluginCss = STYLE_ID;
			style.textContent = BOARD_CSS;
			document.head.appendChild(style);
		}

		/* ------------------------------ 界面 ------------------------------ */

		/**
		 * 顶部统计条。
		 * @param {{total: number, running: number, pending: number, unread: number}} totals
		 * @returns {object}
		 */
		function statsBar(totals) {
			const chips = [
				{ key: "total", label: "会话", value: totals.total, tone: "plain" },
				{ key: "running", label: "运行中", value: totals.running, tone: "running" },
				{ key: "pending", label: "待交互", value: totals.pending, tone: "pending" },
				{ key: "unread", label: "有未读", value: totals.unread, tone: "unread" }
			];
			return h(
				"div",
				{ className: "sb-stats" },
				chips.map((chip) =>
					h(
						"div",
						{ className: "sb-stat", key: chip.key, "data-tone": chip.tone },
						h("span", { className: "sb-stat-value" }, String(chip.value)),
						h("span", { className: "sb-stat-label" }, chip.label)
					)
				)
			);
		}

		/**
		 * 一行会话。
		 * @param {object} row
		 * @param {"running"|"pending"|"unread"|"idle"} kind
		 * @param {string|undefined} currentId
		 * @param {number} now
		 * @returns {object}
		 */
		function sessionRow(row, kind, currentId, now) {
			const meta = [];
			const time = relativeTime(Number.isFinite(row.updatedAt) ? row.updatedAt : 0, now);
			meta.push(time);
			if (isSubagent(row)) meta.push("子代理");
			if (row.blank === true) meta.push("空白会话");
			const activate = () => openSession(row.id);
			const onKeyDown = (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				activate();
			};
			const children = [
				h("span", { className: "sb-dot", key: "dot", "aria-hidden": "true" }),
				h(
					"div",
					{ className: "sb-row-main", key: "main" },
					h("div", { className: "sb-row-title" }, sessionTitle(row)),
					h("div", { className: "sb-row-meta" }, meta.join(" · "))
				)
			];
			if (kind !== "idle") {
				children.push(
					h("span", { className: "sb-badge", key: "badge", "data-kind": kind }, STATUS_LABEL[kind])
				);
			}
			return h(
				"div",
				{
					className: "sb-row",
					role: "button",
					tabIndex: 0,
					key: row.id,
					title: row.id,
					"data-status": kind,
					"data-current": row.id === currentId ? "true" : "false",
					"data-blank": row.blank === true ? "true" : "false",
					"aria-current": row.id === currentId ? "true" : undefined,
					onClick: activate,
					onKeyDown
				},
				children
			);
		}

		/**
		 * 会话总览主面板。数据全部来自标准 props 里的 useSessions /
		 * useSessionStatus / useWorkspaces，不自己发起任何请求。
		 * @param {object} props
		 * @returns {object}
		 */
		function SessionBoardView(props) {
			const useSessions = typeof props.useSessions === "function" ? props.useSessions : useEmptyList;
			const useStatus = typeof props.useSessionStatus === "function" ? props.useSessionStatus : useEmptyStatus;
			const useWorkspaces = typeof props.useWorkspaces === "function" ? props.useWorkspaces : useEmptyWorkspaces;

			const list = useSessions((state) => state);
			const statuses = useStatus((value) => value);
			const workspaceState = useWorkspaces((value) => value);

			const [query, setQuery] = React.useState("");
			const [now, setNow] = React.useState(() => Date.now());

			React.useEffect(() => {
				const timer = setInterval(() => setNow(Date.now()), 30000);
				return () => clearInterval(timer);
			}, []);

			const currentId = typeof props.sessionId === "string" ? props.sessionId : undefined;
			const groups = buildGroups(list, workspaceState, query);
			const totals = countTotals(list, statuses);
			const loading = !list || list.phase !== "ready";
			const trimmed = query.trim();

			const head = h(
				"div",
				{ className: "sb-head", key: "head" },
				h(
					"div",
					{ className: "sb-heading" },
					h("h1", { className: "sb-title" }, "会话总览"),
					h("p", { className: "sb-sub" }, loading ? "正在读取会话列表…" : `${totals.total} 个会话，按最近活动排序`)
				),
				h(
					"div",
					{ className: "sb-actions" },
					h(
						"button",
						{ className: "sb-btn", type: "button", onClick: () => refreshList() },
						"刷新"
					)
				)
			);

			const toolbar = h(
				"div",
				{ className: "sb-toolbar", key: "toolbar" },
				h("input", {
					className: "sb-search",
					type: "search",
					value: query,
					placeholder: "搜索标题、会话 ID、工作目录…",
					"aria-label": "搜索会话",
					onChange: (event) => setQuery(event.target.value),
					onKeyDown: (event) => {
						if (event.key === "Escape") setQuery("");
					}
				}),
				trimmed === ""
					? null
					: h(
							"button",
							{ className: "sb-btn", type: "button", onClick: () => setQuery("") },
							"清除"
						)
			);

			let body;
			if (loading) {
				body = h("div", { className: "sb-empty", key: "loading" }, "正在读取会话列表…");
			} else if (groups.length === 0) {
				body = h(
					"div",
					{ className: "sb-empty", key: "empty" },
					trimmed === "" ? "还没有会话。" : `没有匹配「${trimmed}」的会话。`
				);
			} else {
				body = h(
					"div",
					{ className: "sb-groups", key: "groups" },
					groups.map((group) =>
						h(
							"section",
							{ className: "sb-group", key: group.key },
							h(
								"div",
								{ className: "sb-group-head" },
								h("span", { className: "sb-group-title" }, group.label),
								h("span", { className: "sb-group-count" }, String(group.rows.length))
							),
							h(
								"ul",
								{ className: "sb-list" },
								group.rows.map((row) => {
									const kind = statusKind(statusEntry(statuses, row.id), row);
									return h("li", { key: row.id }, sessionRow(row, kind, currentId, now));
								})
							)
						)
					)
				);
			}

			return h(
				"div",
				{ className: "sb-root" },
				h("div", { className: "sb-inner" }, [head, statsBar(totals), toolbar, body])
			);
		}

		/* ------------------------------ 插件 ------------------------------ */

		exports.name = NAME;
		/*
		 * cordis 的服务属性（ctx.slots 等）只在声明 inject 后才可读，否则抛
		 * `cannot get property "slots" without inject`。这里只声明实际用到的
		 * slots；sessions / uiWorkspace 走 ctx.get()（reflect.get 不受 inject 约束），
		 * 这样它们缺失时插件仍能挂载。
		 */
		exports.inject = ["slots"];

		/**
		 * 向会话界面注册「会话总览」View。
		 * @param {object} ctx - client cordis context。
		 * @returns {void}
		 */
		exports.apply = function apply(ctx) {
			pluginCtx = ctx;
			ctx.slots.inject("conversation.view", () =>
				ctx.slots.register(
					{
						name: "conversation.view",
						id: VIEW_ID,
						order: VIEW_ORDER,
						label: VIEW_LABEL
					},
					SessionBoardView
				)
			);
			ctx.effect(() => installStyles(), "dsh-session-board: styles");
		};

		/* 供 test/smoke.mjs 直接验证纯函数，运行时不使用。 */
		exports.__test = {
			buildGroups,
			countTotals,
			matchesQuery,
			relativeTime,
			sessionTitle,
			statusKind,
			baseName
		};

		return module.exports;
	}
});
