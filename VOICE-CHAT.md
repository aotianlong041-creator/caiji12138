# 后台语音聊天与按需工作

## 数据流

```text
麦克风
  → SenseVoice ASR（不变）
  → POST /dsh-voice/chat
  → 独立 DeepSeek API 调用（快速模式，低 reasoning effort）
      ├─ mode=chat：Breeze TTS 直接播报；不写当前 DSH 会话
      └─ mode=work：把 instruction 通过现有 inputActions 提交到当前 DSH 会话
                      → DSH Agent 自行决定工具/审批
                      → 工作会话内容不再朗读；语音只播后台语音回复
```

## 记忆与侧边栏会话

- 所有语音通话共用一个固定后台 DSH 会话：`dsh-voice-chat-dafish-v2`；不会按工作会话反复新建；
- 通过 DSH Agent 创建/恢复该会话，插件 reload 后用 `ctx.agents.resume()` 接回原会话；
- user/assistant 消息写入该 DSH session log；
- 下一轮用 `deriveMessages()` 读取它，作为后台聊天记忆；
- **后台语音会话不再挂到工作区/侧边栏**；插件启动时会摘除 `dsh-voice-chat*` 和 `voice-bg-*` 的旧工作区投影，避免重启后同时恢复两个语音窗口；
- 旧版 `dsh-voice-chat` 仅作迁移识别，不再作为当前记忆会话；
- 记忆只保存在固定会话 `dsh-voice-chat-dafish-v2` 的 session log 中，不跨会话；
- 每轮只读当前工作会话的运行状态和最近消息摘要（只读、临时，不写入记忆）；
- 语音聊天不写入工作会话，工作摘要也不进入语音记忆；
- 如果该后台 session log 在进程中断后损坏，只重置这一条会话，不要删除整个 `sessions` 目录。

## 模型与人设

- 后台聊天是独立 API 调用，拥有独立的 DSH 会话记忆；
- 新人格为“大肥鱼”：聪明、慵懒、爱吃白饭，略带傲娇和小脾气，偶尔调皮、嘴硬，但内心温柔；不是客服或持续撒娇的女仆，不机械复述口头禅；
- 动作只写在全角括号内，例如“（甩甩尾鳍）”；TTS 前会剥离所有括号内容，只朗读括号外文本；`test/speech-text.cjs` 覆盖全角/半角/嵌套/方括号；
- 当前工作只读状态与摘要作为临时决策提示，不进入记忆；
- 固定使用当前 `voiceId=dafeiyu` 作为大肥鱼基础音色；情绪只通过 Breeze `instructions` 变化，不换 voiceId；
- API 模型返回 `voice_direction`：语速、语调、停顿、重音和表达意图，不允许只写情绪标签；
- Breeze OpenAI JSON 使用 `instructions` 传入演绎指令，`cfg_scale=1.2`、固定 `seed=42`，PCM 流式输出不变；
- TTS 前的文本只取路由 JSON 的 `reply`：宿主用平衡括号解析并在坏 JSON 时只恢复命名字段；客户端再用 `speechText` + `stripForSpeech` 剥离 JSON 结构、字段名、格式标签和括号动作。结构化内容没有 `reply` 时宁可静默，也不会朗读路由 JSON；
- 快速语音模式：`reasoningEffort: low`，提示要求 1-2 句、最多 60 个汉字、先给结论；
- 内置钟表：`lib/clock.js` 读取宿主本地时区，生成日期、时分、秒和星期；`GET /dsh-voice/clock` 可查询，语音中“现在几点 / 今天几号 / 今天星期几”走确定性直答，其余每轮也会把当前 `clock.line` 注入模型提示。DSH 自带的 `@deepseek-ai/dsh-time-context` 只注入 Agent pre-step，语音后台直接调用 `llm.stream` 不会收到它，因此这里单独补时钟上下文；
- 模型自行判断 chat/work，不使用本地关键词规则。
- 防误操作闸门：模型判定为 work 时不直接提交，只保存待执行指令并用语音询问“可以执行吗”；用户回应后由 `/dsh-voice/confirm-work` 语义判断，只有高置信度 `confirm` 才调用 `setDraft + submit`，明确 `cancel` 才丢弃；条件句、含糊回答、判断失败或超时一律不执行并继续询问。确认期间的新语音不会再走 chat；无确认按钮。

## 会话提交

只有 `mode=work` 时浏览器才调用：

```js
actions.setDraft(instruction)
actions.submit()
```

`mode=chat` 不触碰输入框、不提交 DSH 消息。

## 通话窗口常驻

- 通话 UI/媒体图挂在 root-scoped `shell.overlay`，不会随会话切换卸载；
- `conversation.input.right` 只保留一个无 UI 的 bridge，把当前 `sessionId/inputActions` 发布给常驻组件；
- 切换会话只更新“当前工作目标”，麦克风、TTS 队列、通话面板继续运行；
- 语音浮窗位于右下角，面板和角色仍用 fixed 定位；
- 已实测 `shell.overlay` 注册成功，会话切换不经过该 Slot 的重建。

## TTS 首句延迟与 PCM 连续性

- Host 新增 `POST /dsh-voice/tts-stream`：Breeze 以 `response_format=pcm` 直接流式返回 24 kHz s16le PCM；
- 浏览器使用**单一 24 kHz AudioContext**，由 `ScriptProcessor` 连续队列输出，不再为每个 chunk 建独立 `AudioBufferSource`，也不再把每块单独 resample 到 48 kHz；
- 块边界保留未成对的 PCM 半字节，下一块拼接后再转 Int16，不丢字节、不重复、不截断；
- 队列欠采样时输出静音补齐，不跳过样本；
- 若浏览器未按请求提供 24 kHz 上下文，才做线性重采样兜底；
- 短回复作为一个 TTS 请求发送，Breeze 自己按句流式生成，减少句间空档；
- 保留 `POST /dsh-voice/tts` 作为设置页/回退路径；
- 实测同一测试句：
  - 旧 `/tts` 等完整音频：`1109–1127 ms` 才返回；
  - `/tts-stream` 第一块：`199–209 ms`，完整流结束 `794–804 ms`；
  - 长句直连 Breeze 实测存在 64233/4887 字节的奇数块，客户端跨块保留半字节后不再错位。

## 音色配置

- 设置页保存 `voiceId` 到 `~/.dsh/dsh-voice-duplex.json`，Host 的 `applyConfig` 立即更新内存配置；
- `/tts-stream` 和 `/tts` 现在都以**已保存配置**的 `voiceId` 为准，浏览器传来的旧 `voice` 不能覆盖它；
- 客户端每次开始通话会重新 GET `/config`，保存设置时也会广播 `dsh-voice-config`；
- `BreezeClient.config` 在保存时同步替换，避免构造时旧引用；
- 已验证 Breeze 对 `dsh_voice`、`dafeiyu`、`ref01` 生成的 PCM 哈希不同，音色 ID 本身有效；
- 响应头 `x-voice-id` 可用于确认实际请求使用的音色；
- 插件 reload 会重启 Breeze；Host 现在对 Breeze 连接失败做 6 次短重试，使用 `connection: close` 避免旧 keep-alive socket，并让健康检查快速触发 Breeze 启动；
- 设置页 `/health`、`/voices`、首次 TTS 请求不会再因 Breeze 冷启动而误报“音色不存在/未生效”。

## 兼容

ASR、Breeze TTS 2、语音打断、角色动画、DSH 工具与审批均沿用原实现。

## 回滚

- 改动前备份：
  `<AI_HOME>\backups\dsh-voice-duplex-pre-background-chat-20261026-093737.zip`
- 回滚时用该 zip 覆盖 `dsh-voice-duplex`，或回退对应 Git commit 后 reload `include:dsh-voice-duplex`。
