# 从本地到 GitHub

这台机器上**没有 git、没有 gh CLI、也没有任何已保存的 GitHub 凭据**（`where git` / `gh auth status` / `cmdkey /list` 都没有命中），
所以最后一步「推到你自己的账号」需要你在浏览器里授权一次。下面三条路任选一条。

仓库建议名：`dsh-session-board`，可见性按你意愿（插件是 MIT，公开更合适）。

---

## 路线 A：网页上传（最快，不需要任何凭据）

1. 打开 <https://github.com/new>，Repository name 填 `dsh-session-board`，选 Public 或 Private，**不要**勾选
   "Add a README file" / ".gitignore" / "license"（我们已经有这些文件了），点 Create repository。
2. 解压 `dsh-session-board-repo.zip`，在页面上点 **uploading an existing file**，
   把解压出来的 `lib/`、`test/`、`package.json`、`README.md`、`LICENSE`、`cordis.patch.yml` 拖进去。
3. 浏览器拖文件夹时会跳过隐藏文件（`.gitignore`、`.github/`），补两步：
   - **Add file → Create new file**，文件名填 `.gitignore`，内容从本地 `.gitignore` 复制；
   - 同理新建 `.github/workflows/smoke.yml`（文件名里直接写斜杠即可建目录），内容从本地同名文件复制。
4. 提交信息填 `init: dsh-session-board 0.1.1`，点 **Commit changes**。
5. 打一个 release 供别人直接安装：**Releases → Draft a new release**，tag 填 `v0.1.1`，
   把 `dsh-session-board-0.1.1.tgz` 拖进附件区，发布。

装插件的人只需要：下载 tgz → DSH 里 Plugin Manager 安装。

---

## 路线 B：让我替你推（你只需在浏览器创建一个 token）

1. 打开 <https://github.com/settings/tokens?type=beta> → **Generate new token**（fine-grained）：
   - Resource owner = 你的账号；Repository access = **All repositories**（或先建空仓库再选它）；
   - Permissions → Repository permissions → **Administration: Read and write**、**Contents: Read and write**。
2. 生成后**不要把 token 贴到对话里**。在你自己开的 PowerShell 窗口里执行：
   ```powershell
   setx GITHUB_TOKEN "ghp_你的token"
   ```
   然后**新开一个**终端（没新开的话 DSH 里读不到）。
3. 回来告诉我「token 已设置」，我就用 GitHub REST API 建仓库、提交这 9 个文件、建 release。
   用完你可以立刻去 Settings 里把 token 撤销。

---

## 路线 C：先装 Git，我来跑命令

1. 装 Git for Windows（<https://git-scm.com/download/win>）或 GitHub Desktop。
2. 登录一次（GitHub Desktop 会弹浏览器授权；git 用 Git Credential Manager 也会弹）。
3. 告诉我装好了，我执行：
   ```bash
   cd dsh-dev/dsh-session-board
   git init -b main
   git add -A
   git commit -m "init: dsh-session-board 0.1.1"
   git remote add origin https://github.com/<你的用户名>/dsh-session-board.git
   git push -u origin main
   ```

注意：这台机器的 PowerShell 走不了直连 TLS（`curl` 报 `SEC_E_NO_CREDENTIALS`），
但 **node 的 fetch 能正常访问 api.github.com**（已验证 `GET /zen` 返回 200）。
系统里配了 `127.0.0.1:7890` 代理，端口是通的；路线 B 走 node 不需要代理设置。
