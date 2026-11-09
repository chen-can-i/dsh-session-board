/**
 * dsh-session-board —— host half.
 *
 * 本插件的全部能力都在浏览器侧（lib/client.js）：往会话界面注册一个
 * 「会话总览」View，按工作区分组列出所有会话、运行状态与统计，可搜索、可跳转。
 * host 半只需要存在一个合法的 cordis 插件，让 loader 行能挂载。
 *
 * 读会话数据用的是 client 侧已有的标准源（useSessions / useSessionStatus /
 * useWorkspaces），因此这里不注入任何服务、也不联网。
 */

/** Plugin id（与包名一致；cordis 的 `name` 导出）。 */
export const name = 'dsh-session-board'

/** 不声明任何 seat：本插件不读取 host 侧服务。 */
export const inject = []

/**
 * No-op host apply.
 * @param {import('@deepseek-ai/cordis').Context} _ctx
 */
export function apply(_ctx) {}
