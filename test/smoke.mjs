/**
 * 无浏览器冒烟测试：桩掉 ModuleLoader / React / document / ctx，验证
 * 1) 插件导出与 slot 注册形状；2) 面板能渲染出分组、状态、统计；
 * 3) 纯函数（分组、过滤、统计、相对时间）行为正确。
 *
 * 运行：node test/smoke.mjs
 */

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const MINUTE = 60000;

/* ----------------------------- 桩：ModuleLoader ----------------------------- */

let registration = null;
globalThis.window = {
	__ModuleLoader__: {
		load(record) {
			registration = record;
		}
	}
};

/* -------------------------------- 桩：React -------------------------------- */

const reactStub = {
	createElement(type, props, ...children) {
		const flat = [];
		for (const child of children) {
			if (Array.isArray(child)) flat.push(...child);
			else flat.push(child);
		}
		return { type, props: { ...(props ?? {}), children: flat } };
	},
	useState(initial) {
		const value = typeof initial === "function" ? initial() : initial;
		return [value, () => {}];
	},
	useMemo(factory) {
		return factory();
	},
	useRef(value) {
		return { current: value };
	},
	useCallback(fn) {
		return fn;
	},
	useEffect() {
		/* 不执行副作用：避免在 Node 里真的开 setInterval。 */
	}
};

/* ------------------------------- 桩：document ------------------------------ */

let appendedStyles = 0;
globalThis.document = {
	head: {
		querySelector() {
			return null;
		},
		appendChild(node) {
			appendedStyles += 1;
			return node;
		}
	},
	createElement() {
		return { dataset: {}, textContent: "", remove() {} };
	}
};

/* --------------------------------- 断言工具 -------------------------------- */

let failures = 0;
let checks = 0;

function check(label, condition) {
	checks += 1;
	if (condition) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}`);
}

function collectText(node) {
	if (node === null || node === undefined || node === false || node === true) return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(collectText).join(" ");
	if (typeof node === "object" && node.props !== undefined) {
		return collectText(node.props.children);
	}
	return "";
}

/* ---------------------------------- 夹具 ---------------------------------- */

const LIST = {
	phase: "ready",
	ids: ["s1", "s2", "s3", "s4"],
	byId: {
		s1: {
			id: "s1",
			title: "重构退单流程",
			displayTitle: "重构退单流程",
			running: false,
			updatedAt: NOW - 5 * MINUTE,
			cwd: "D:\\个人\\投资\\交易往来",
			blank: false,
			formatStatus: "current"
		},
		s2: {
			id: "s2",
			title: "",
			displayTitle: "第二会话",
			running: false,
			updatedAt: NOW - 2 * 60 * MINUTE,
			cwd: "D:\\个人\\投资\\交易往来",
			blank: false
		},
		s3: {
			id: "s3",
			title: "子代理输出",
			displayTitle: "",
			running: false,
			updatedAt: NOW - 3 * 24 * 60 * MINUTE,
			cwd: "D:\\scratch\\tmp",
			origin: "subagent",
			parentId: "s2"
		},
		s4: {
			id: "s4",
			title: "未归区会话",
			displayTitle: "",
			running: false,
			updatedAt: NOW - 24 * 60 * MINUTE,
			cwd: "",
			blank: true
		}
	}
};

const STATUS = new Map([
	["s1", { running: true, pendingInteraction: undefined, completionUnread: false }],
	["s2", { running: false, pendingInteraction: { kind: "permission" }, completionUnread: false }],
	["s4", { running: false, pendingInteraction: undefined, completionUnread: true }]
]);

const WORKSPACES = {
	phase: "ready",
	items: [
		{
			workspaceId: "w1",
			title: "交易往来项目",
			path: "D:\\个人\\投资\\交易往来",
			sessionIds: ["s1", "s2"]
		}
	]
};

/* ----------------------------------- 主流程 -------------------------------- */

await import("../lib/client.js");

check("ModuleLoader 收到了一份注册", registration !== null);
check("注册 id 是 dsh-session-board", registration?.id === "dsh-session-board");

const bundle = registration.factory((request) => {
	if (request === "react") return reactStub;
	throw new Error(`unexpected require: ${request}`);
});

check("导出 name", bundle.name === "dsh-session-board");
check("导出 inject 声明了 slots", Array.isArray(bundle.inject) && bundle.inject.includes("slots"));
check("导出 apply 是函数", typeof bundle.apply === "function");

/* --- ctx 桩：执行 apply --- */

const registrations = [];
const effects = [];
const ctx = {
	slots: {
		inject(name, callback) {
			check(`slots.inject 声明了 ${name}`, name === "conversation.view");
			callback();
		},
		register(meta, component) {
			registrations.push({ meta, component });
			return { dispose() {} };
		}
	},
	effect(run) {
		effects.push(run);
		return { dispose() {} };
	},
	get() {
		return undefined;
	}
};

bundle.apply(ctx);

check("注册了一条 View", registrations.length === 1);
const entry = registrations[0];
check("注册名是 conversation.view", entry?.meta?.name === "conversation.view");
check("View id 是 session-board", entry?.meta?.id === "session-board");
check("View label 是会话总览", entry?.meta?.label === "会话总览");
check("View order 是 20", entry?.meta?.order === 20);
check("注册了样式 effect", effects.length === 1);
effects[0]?.();
check("样式被注入一次", appendedStyles === 1);

/* --- 渲染 --- */

const statusGetter = (selector) => selector(STATUS);
const listGetter = (selector) => selector(LIST);
const workspaceGetter = (selector) => selector(WORKSPACES);

const view = entry.component({
	sessionId: "s2",
	useSessions: listGetter,
	useSessionStatus: statusGetter,
	useWorkspaces: workspaceGetter
});
const text = collectText(view);

check("标题渲染", text.includes("会话总览"));
check("工作区分组名渲染", text.includes("交易往来项目"));
check("未归入工作区分组渲染", text.includes("未归入工作区"));
check("会话标题渲染", text.includes("重构退单流程") && text.includes("第二会话"));
check("子代理标记渲染", text.includes("子代理"));
check("运行中统计渲染", text.includes("运行中"));
check("待交互统计渲染", text.includes("待交互"));
check("未读统计渲染", text.includes("有未读"));
check("统计总数是 4", /\b4\b/.test(text));

/* --- 纯函数 --- */

const api = bundle.__test;
check("__test 导出完整", ["buildGroups", "countTotals", "relativeTime", "statusKind"].every((key) => typeof api[key] === "function"));

const groups = api.buildGroups(LIST, WORKSPACES, "");
check("分成三组（工作区 / 路径 / 未归区）", groups.length === 3);
check("工作区组排第一", groups[0].key === "workspace:w1" && groups[0].rows.length === 2);
check("未归区组排最后", groups[groups.length - 1].key === "unassigned");

const filtered = api.buildGroups(LIST, WORKSPACES, "  第二  ");
check("按标题搜索命中一个会话", filtered.length === 1 && filtered[0].rows.length === 1 && filtered[0].rows[0].id === "s2");

const byIdQuery = api.buildGroups(LIST, WORKSPACES, "s3");
check("按会话 id 搜索命中", byIdQuery.length === 1 && byIdQuery[0].rows[0].id === "s3");

const byPathQuery = api.buildGroups(LIST, WORKSPACES, "scratch");
check("按工作目录搜索命中", byPathQuery.length === 1 && byPathQuery[0].rows[0].id === "s3");

const byWorkspaceQuery = api.buildGroups(LIST, WORKSPACES, "交易往来项目");
check("按工作区标题搜索命中两个会话", byWorkspaceQuery.length === 1 && byWorkspaceQuery[0].rows.length === 2);

const missing = api.buildGroups(LIST, WORKSPACES, "不存在的关键字");
check("无命中时返回空分组", missing.length === 0);

const totals = api.countTotals(LIST, STATUS);
check("统计 total", totals.total === 4);
check("统计 running", totals.running === 1);
check("统计 pending", totals.pending === 1);
check("统计 unread", totals.unread === 1);
check("统计 subagents", totals.subagents === 1);

check("状态优先级 running", api.statusKind({ running: true, completionUnread: true }, {}) === "running");
check("状态优先级 pending", api.statusKind({ running: false, pendingInteraction: {} }, {}) === "pending");
check("状态 unread", api.statusKind({ running: false, completionUnread: true }, {}) === "unread");
check("状态 idle", api.statusKind(undefined, { running: false }) === "idle");
check("列表行 running 兜底", api.statusKind(undefined, { running: true }) === "running");

check("刚才", api.relativeTime(NOW - 1000, NOW) === "刚刚");
check("分钟", api.relativeTime(NOW - 5 * MINUTE, NOW) === "5 分钟前");
check("小时", api.relativeTime(NOW - 2 * 60 * MINUTE, NOW) === "2 小时前");
check("天", api.relativeTime(NOW - 3 * 24 * 60 * MINUTE, NOW) === "3 天前");
check("无时间", api.relativeTime(0, NOW) === "无时间");

/* --------------------------------- 结论 ---------------------------------- */

console.log("");
if (failures === 0) {
	console.log(`全部通过：${checks} 项检查。`);
} else {
	console.log(`${failures} / ${checks} 项检查失败。`);
	process.exitCode = 1;
}
