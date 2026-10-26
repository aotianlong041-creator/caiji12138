# GitHub 开源发布清单

当前仓库已发布到 GitHub：

```text
https://github.com/aotianlong041-creator/caiji12138
```

## 当前状态

- 远端：`origin` → `https://github.com/aotianlong041-creator/caiji12138.git`
- 默认分支：`main`
- 已发布提交：见远端 `main` 最新提交
- 版本：`1.1.2`
- 许可证：代码与随包音色库 MIT；Breeze 权重不随包、非商用许可；详见 `LICENSE` / `NOTICE.md`
- 包元数据：`package.json` 的 `license` 为 `MIT`
- 说明书：`docs/VOICE-CLOCK.md`
- 随包音色：`assets/voices/`（15 个 `.breeze`）
- GitHub About：已填写项目简介与 topics
- 敏感信息：未发现真实 Cookie/API Key；本机绝对路径已改为占位符
- 自动测试：`npm test`、`node test/host-harness.mjs`、`git diff --check` 已通过

## 已自动完成

1. 新增语音钟表功能说明，覆盖功能、配置、启动、接口和常见问题。
2. 新增标准 MIT `LICENSE`，与 `package.json` 的 license 字段保持一致。
3. 清理文档、测试和默认路径中的本机绝对路径：
   - 文档使用 `<repo>`、`<AI_HOME>`、`<DSH_HOME>` 等占位符；
   - 测试脚本使用 `__dirname`、环境变量和系统临时目录；
   - 代码默认目录改为 `DSH_HOME` 派生路径，保留现有用户配置覆盖能力。
4. 补充 `.gitignore`：
   - `voice-samples/`（本机生成的音频样本）
   - `.env` / `.env.*`
   - `credentials*.json`
   - `*.pem` / `*.key` / `*.p12`
5. 扫描已跟踪文件，确认没有真实 Cookie、Bearer token、API Key 或凭据文件。
6. 提交文档、许可证和清理改动。

## 推送前需要你确认

1. GitHub 仓库地址（HTTPS 或 SSH）。
2. 推送目标分支：
   - 当前分支 `feature/dafeiyu-3d-rebuild`，或
   - 先合并/改名为 `main` 再推送。
3. 明确回复“确认推送”。

## 推送步骤

### 1. 在 GitHub 创建空仓库

不要勾选自动生成 README、LICENSE 或 `.gitignore`，本仓库已经有这些文件。

### 2. 配置远端

```bash
git remote add origin <YOUR_GITHUB_REPO_URL>
git remote -v
```

### 3. 确认远端与分支

```bash
git status
git log --oneline -5
git branch --show-current
```

确认当前分支和提交无误后：

```bash
git push -u origin feature/dafeiyu-3d-rebuild
```

如果目标分支是 `main`：

```bash
git branch -M main
git push -u origin main
```

不要使用 `--force`，除非你明确知道自己在覆盖什么。

### 4. 推送后检查

- GitHub 仓库页面能看到 `LICENSE`、`README.md`、`docs/VOICE-CLOCK.md`；
- 仓库的 License 显示为 MIT；
- 确认 `voice-samples/`、`.env`、凭据文件没有出现在 GitHub；
- 检查默认分支和 Actions/Issues 设置。

## 敏感信息复查

推送前可再次检查：

```bash
git grep -nE 'C:\\Users\\|/Users/|sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|Bearer[[:space:]]+[A-Za-z0-9._-]{8,}'
```

匹配结果需要逐条判断。测试 fixture 里的 `task_complete` 会误命中 `sk-` 规则，它不是密钥。

## 不要提交的内容

- 本机 `dsh-voice-duplex.json` 中的个人模型、音色和目录配置；
- Cookie、API Key、私钥；
- `voice-samples/` 和任何个人音色样本；
- `node_modules/`、备份包和日志。

## 许可证

MIT。第三方依赖各自遵循其许可证；发布时保留依赖声明与 LICENSE。
