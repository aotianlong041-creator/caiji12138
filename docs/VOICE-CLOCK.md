# dsh-voice-duplex 语音通话、模型安装与时钟说明书

本文是当前 `dsh-voice-duplex` 的中文使用说明，覆盖语音通话、Breeze 模型选择与安装、随包音色库、时钟能力、接口和排错。

## 1. 功能概览

- **全双工语音**：持续采集麦克风，本地 VAD 断句，助手播报时可以插话打断。
- **本地 ASR**：SenseVoice + `sherpa-onnx-node`，音频不经过云语音服务。
- **本地 TTS**：Breeze TTS 2，PCM 流式播放。
- **大肥鱼人格**：后台语音模型返回简短台词和 `voice_direction`，不朗读 JSON、字段名或格式说明。
- **工作确认**：模型判定为 `work` 时先语音确认，不会直接提交工作指令。
- **本地时钟**：每轮语音注入本地日期、时分秒和星期；“现在几点/今天几号/今天星期几”直接由宿主回答。
- **模型管理器**：设置页检测 CPU、内存和 GPU，推荐 Breeze 量化模型，自动下载所选模型、运行时和可选 ASR 权重，并写回配置。
- **随包音色库**：`assets/voices/` 提供 15 个 `.breeze` 音色，安装后即可选择。

## 2. 环境要求

- Node.js **22.19+**；
- DSH Web 环境；
- Windows 10/11 x64（自动安装 Breeze 运行时目前只支持 Windows x64）；
- 麦克风和浏览器麦克风权限；
- 可选：NVIDIA 驱动 + `nvidia-smi`（用于自动检测显存；AMD/Intel 也可用 Vulkan 运行时，但自动显存检测可能显示为未检测到）。

## 3. Breeze 模型参数

| 模型 | 文件大小 | 约需显存 | 适用场景 |
| --- | ---: | ---: | --- |
| Q4_K | 2.4 GB | ~3 GB | 低显存/CPU 回退；体积最小，长文细节较弱 |
| Q6_K | 2.9 GB | ~3.5 GB | 质量和速度折中 |
| Q8_0 | 3.3 GB | ~4 GB | 官方推荐；稳定性和音质更稳 |
| F16 | 5.9 GB | ~7 GB | 参考质量，下载和加载最重 |

设置页会根据硬件给出推荐值：

- 显存 ≥ 7 GB → F16；
- ≥ 4 GB → Q8_0；
- ≥ 3.5 GB → Q6_K；
- ≥ 3 GB 或无法检测显存 → Q4_K（CPU 回退也建议 Q4_K）。

没有 NVIDIA 显卡时，GPU 名称可能无法准确读取，这不影响选择模型；只是推荐会更偏保守。

## 4. 首次安装

### 4.1 安装插件

```bash
dsh plugin --profile desktop add "link:<repo>"
```

`<repo>` 是本仓库目录。插件代码/依赖变化后按 DSH 提示重启一次。

### 4.2 打开设置页

打开：

```text
设置 → 语音通话
```

设置页会自动请求 `/models/catalog`，显示：

- 本机 CPU/线程/内存；
- 检测到的 GPU 和显存；
- 推荐模型；
- 模型、运行时、ASR、随包音色的安装状态；
- 模型保存路径输入框。

**安装插件后不需要手工找模型**；打开设置页就会列出缺失项。

### 4.3 选择并安装

1. 选择 TTS 模型（默认是推荐型号）；
2. 可修改模型保存路径，留空使用默认 `DSH_HOME/voice-models`；
3. 勾选是否安装 Breeze 运行时和 SenseVoice ASR；
4. 勾选“我接受 Breeze 权重的非商用许可”；
5. 点“安装所选模型与依赖”。

安装器会：

- 从 Hugging Face 官方 GGUF 文件下载所选模型；
- 下载 Windows Vulkan 运行时压缩包并解压；
- 可选下载 SenseVoice ONNX 与 tokens；
- 对每个下载文件按固定大小和 SHA-256 校验；
- 使用临时文件，校验通过后才替换；
- 下载完成后写回：

```json
{
  "modelDir": "<模型目录>",
  "breezeModelPath": "<模型目录>/breeze-tts-2-q*.gguf",
  "breezeServerPath": "<模型目录>/breeze-v0.1.3-win32-x64/breeze-server.exe",
  "asrModelPath": "<模型目录>/asr/model.int8.onnx",
  "asrTokensPath": "<模型目录>/asr/tokens.txt",
  "breezeVoicesDir": "<插件目录>/assets/voices"
}
```

大文件下载期间可以点“取消下载”；已经完成的文件会保留并在下次安装时复用。

### 4.4 手动配置

如果不使用安装器，编辑：

```text
~/.dsh/dsh-voice-duplex.json
```

核心字段：

```json
{
  "breezeUrl": "http://127.0.0.1:8080",
  "breezePort": 8080,
  "voiceId": "dafeiyu",
  "modelDir": "<模型目录>",
  "breezeModelPath": "<模型目录>/breeze-tts-2-q8_0.gguf",
  "breezeServerPath": "<运行时目录>/breeze-server.exe",
  "breezeVoicesDir": "<插件目录>/assets/voices",
  "asrModelPath": "<模型目录>/asr/model.int8.onnx",
  "asrTokensPath": "<模型目录>/asr/tokens.txt",
  "asrThreads": 2,
  "endpointSilenceMs": 1500,
  "bargeIn": true,
  "maxUtteranceSec": 20,
  "speechRate": 0.9
}
```

模型和大文件不在仓库里；只填路径不会自动下载。

## 5. 随包音色库

`assets/voices/` 包含：

```text
dafeiyu.breeze
dsh_voice.breeze
dsh_voice_clear.breeze
dsh_voice_sapi.breeze
ref01.breeze … ref11.breeze
```

默认 `voiceId` 为 `dafeiyu`，默认 `breezeVoicesDir` 指向这个随包目录。音色库由项目所有者提供并授权随项目开源；具体许可见 `assets/voices/README.md` 和 `NOTICE.md`。

## 6. 启动

### 启动 Breeze

安装器安装成功后会自动尝试启动。也可以：

- 设置页点“启动 Breeze”；
- 或手动启动配置里的 `breezeServerPath`：

```powershell
<breeze-server.exe> <model.gguf> --host 127.0.0.1 --port 8080 --voices-dir <voices-dir>
```

检查：

```text
GET http://127.0.0.1:8080/health
```

### 开始语音

刷新 DSH 页面，点输入框右侧麦克风按钮。时钟、语音路由和工作确认会自动生效。

## 7. 接口

所有接口由 DSH Web 宿主提供，只接受同源/受信请求。

### 7.1 模型目录与检测

```http
GET /dsh-voice/models/catalog
```

返回 `hardware`、`models`、`recommended`、`runtime`、`asr`、`installed`、`bundledVoicesDir`。

```http
GET /dsh-voice/models/status?modelDir=<dir>
```

返回指定目录下模型、运行时、ASR 和音色的安装状态。

### 7.2 安装与进度

```http
POST /dsh-voice/models/install
Content-Type: application/json

{
  "modelId": "q8_0",
  "modelDir": "<dir>",
  "installRuntime": true,
  "installAsr": true,
  "acceptLicense": true
}
```

返回 `202` 后，用：

```http
GET /dsh-voice/models/progress
```

查看 `status`、`progress.phase`、`completedBytes`、`totalBytes`。取消：

```http
POST /dsh-voice/models/cancel
```

`acceptLicense` 必须为 `true`；Breeze 权重是 **Research and Non-Commercial** 许可。

### 7.3 时钟

```http
GET /dsh-voice/clock
```

```json
{
  "ok": true,
  "clock": {
    "date": "2026-10-26",
    "time": "19:30:00",
    "weekday": "星期一",
    "timeZone": "Asia/Shanghai",
    "line": "2026-10-26 星期一 19:30:00（Asia/Shanghai）"
  }
}
```

### 7.4 语音聊天

```http
POST /dsh-voice/chat

{ "text": "现在几点？", "sessionId": "<session>" }
```

纯时间/日期/星期问题由宿主直接回答，返回 `reply` 和 `clock`，不调用模型。其他问题会带上本轮 `clock.line` 进入模型。

### 7.5 流式 TTS

```http
POST /dsh-voice/tts-stream

{ "text": "要朗读的台词", "instructions": "可选演绎指令", "voice": "dafeiyu" }
```

返回 `audio/pcm`，采样率见 `x-sample-rate`。

## 8. 常见问题

### 设置页一直显示“正在检测硬件”

`nvidia-smi` 超时或 PowerShell GPU 查询较慢。等待几秒后重试；没有 NVIDIA 显卡时会走保守推荐。

### 设置页提示“Breeze 尚未就绪 / 读取音色失败”

这表示运行时、模型或 ASR 还没装齐，或者 Breeze 进程没启动。按顺序处理：

1. 打开「模型与依赖」，确认“运行时 / ASR”勾选；
2. 勾选“接受非商用许可”；
3. 点“安装 / 更新”，等模型、运行时、ASR 下载完成；
4. 回到设置页点“启动 Breeze”；
5. 再点“刷新音色”。

### 重启后出现两个语音窗口/历史加载失败

后台语音会话是隐藏的，不应出现在工作区侧栏。如果旧版本已经留下 `dsh-voice-chat*` 或 `voice-bg-*` 投影，升级到当前版本后重启，插件会自动摘除这些投影；不要手动删除普通工作会话。若历史文件已经损坏，只重置 `dsh-voice-chat-dafish-v2` 这一条语音后台会话。

不要只填路径，也不要手工把半截文件改成目标文件名。

### 安装失败/下载很慢

- 安装器直连 Hugging Face 和 GitHub，网络受限时需要**全局代理/TUN**；仅设置浏览器代理不够；
- 不要用另一个 AI 会话里的 `curl`/命令手工下载；用设置页的“安装 / 更新”，它会按固定 SHA-256 校验；
- 确认目标目录可写、磁盘空间足够（至少预留模型大小 + 运行时 + ASR）；
- 失败后可重试，已校验完成的文件会复用；
- 错误信息会给出失败文件名和官方地址，便于判断是网络还是权限问题；
- 不要手工把未校验文件改名成目标文件。

### 安装命令出现“退出码 1”

先看具体是哪个命令失败。常见原因是 Hugging Face/GitHub 连接超时、代理没走全局、PowerShell 解压受限或目标目录无权限。不要反复盲跑；改用设置页安装器，或按错误里的官方 URL 手动下载后再填入正确路径。

### 模型安装完成但 Breeze 不健康

检查 `breezeServerPath` 是否存在、Vulkan/AVX2 是否可用，以及运行时是否需要重启。插件会重启自己启动的 Breeze；外部启动的服务需要手动重启。

### “现在几点”仍然像在猜

确认 `/models/status` 正常、插件已重载；再检查 `/dsh-voice/clock`。时钟是宿主本地时间，不依赖模型。

### 语音播报 JSON/字段名

TTS 前会从模型 JSON 中只提取 `reply`，并剥离字段名、代码围栏和括号动作；如果没有 `reply`，宁可不播报。

### TTS 提示 `busy, another generation is running`

这是 Breeze 上一段音频还没生成完，新的语音请求被拒绝。客户端会串行重试 8 次并显示“等待 Breeze 空闲”，不会把原始 JSON 错误直接抛给用户。连续失败时等几秒再试，或重启 Breeze。

### 想改用其他量化模型

设置页重新选择模型并安装即可。不同模型共用同一个 `modelDir`，旧文件会保留；可自行清理不再使用的 `.gguf`。

### 音色库是否随插件分发

是。`assets/voices/` 随包提供 15 个 `.breeze`；Breeze 权重、运行时和 ASR 大文件不随包，按需安装。

## 9. 测试

```bash
node --check lib/index.js
node --check lib/models.js
node --check client.js
npm test
node test/client-render.cjs
node test/host-harness.mjs
```

`npm test` 包含 smoke、文本清洗、时钟和模型目录测试；`host-harness` 会检查模型目录/状态、时钟、语音和 TTS 路由。模型下载不在自动测试中执行。

## 10. 隐私与许可

- 音频只在本机麦克风、SenseVoice 和 Breeze 之间流动；
- 模型安装器只访问固定 HTTPS 下载源，不发送本地文件；
- 代码与随包音色库为 MIT；
- Breeze GGUF 权重为非商用许可，需另行取得商用授权；
- Breeze 运行时为 Apache 2.0；SenseVoice/其他依赖遵循各自上游许可。

完整第三方说明见 `NOTICE.md`，许可证见 `LICENSE`。
