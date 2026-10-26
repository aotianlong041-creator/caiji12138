# 大肥鱼语音助手 · DSH Voice Duplex

本地优先的 DSH 全双工中文语音助手：**Breeze TTS 2 本地出声 + SenseVoice 本地识别 + 说话即插话**。音频不经过云语音服务，DSH 只接收最终转写文本。

设置页内置模型管理器：自动检测内存/显存，推荐 Q4_K / Q6_K / Q8_0 / F16，支持自定义模型保存路径，一键下载模型、Breeze 运行时和可选 ASR 权重并写回配置。项目随包提供 15 个 Breeze 音色文件，模型权重不随仓库分发。

- 本地 TTS / ASR，麦克风持续监听，支持插话打断；
- 大肥鱼人格、自然语音演绎指令和工作确认；
- 内置本地时钟：日期、时分秒、星期和时区；
- 语音路由 JSON 不会进入 TTS 播报；
- 代码与随包音色库 MIT；Breeze 权重单独遵循非商用许可。

## 快速开始

```bash
dsh plugin --profile desktop add "link:<repo>"
```

重新加载 DSH → 刷新页面 → 打开「设置 → 语音通话」→ 模型与依赖里勾选“接受非商用许可”，安装运行时、模型和 ASR，再点“启动 Breeze”。详细步骤见 [说明书](docs/VOICE-CLOCK.md)。

> 下载需要访问 Hugging Face 和 GitHub；网络受限时请先开启全局代理/TUN，不要用另开的 AI 会话手工 `curl`。

## 文档

- [语音通话、模型安装与时钟说明书](docs/VOICE-CLOCK.md)
- [语音会话设计与行为约定](VOICE-CHAT.md)
- [GitHub 开源发布清单](docs/GITHUB-PUBLISH.md)
- [第三方组件与模型许可说明](NOTICE.md)

## 3D 模块

3D 资产、Three.js/VRM 依赖、宿主路由、客户端挂载、3D 工具和构建脚本已从仓库删除。当前语音卡片不包含三维角色；语音、ASR、TTS、时钟和工作确认不受影响。

## 组成

- **浏览器半区**：输入框右侧的 🎙 按钮、持续麦克风采集、VAD、分句播放、插话打断、设置页。
- **宿主半区**：`/dsh-voice/*` 同源路由；SenseVoice 子进程；Breeze OpenAI 兼容 TTS 代理；assistant 文本投影。
- **Breeze TTS 2**：独立本地服务（`<AI_HOME>\runtimes\...\breeze-server.exe`），默认 `127.0.0.1:8080`。
- **SenseVoice**：`sherpa-onnx-node` + `<AI_HOME>\models\asr\model.int8.onnx` + `tokens.txt`。

## 安装

已经通过本地 link 安装到 `desktop` profile：

```powershell
# 重新安装（如果需要）
dsh plugin --profile desktop add link:<repo>
```

插件会自动出现「语音通话」设置页；输入框右侧出现 🎙 按钮。若按钮暂时不可见，
刷新一次 DSH 页面（宿主半区已热加载，无需重启应用）。

## 启动本地 TTS

```powershell
<DSH_HOME>\voice-models\breeze-v0.1.3-win32-x64\breeze-server.exe `
  <DSH_HOME>\voice-models\breeze-tts-2-q8_0.gguf `
  --host 127.0.0.1 --port 8080 --voices-dir <repo>\assets\voices --webui
```

或在「设置 → 语音通话」点「启动 Breeze」。确认：

```text
http://127.0.0.1:8080/health
```

## 使用

1. 打开「设置 → 语音通话」，在“模型与依赖”里检测硬件、选择模型与保存路径，安装缺失依赖。
2. 确认音色（默认 `dafeiyu`）和 ASR 路径，保存配置。
3. 回到对话，点输入框右侧 🎙，开始说话。
4. 静音约 1.5 秒后提交；模型判定为工作需要执行时，会先语音询问，你确认后才提交。
5. 朗读过程中继续说话会触发 barge-in；点面板「停止」结束通话。

模型安装、时钟、接口和常见问题详见 [说明书](docs/VOICE-CLOCK.md)。

## 语音链路

```text
麦克风 48k → 浏览器重采样 16k → VAD 端点
  → POST /dsh-voice/asr → SenseVoice 子进程 → 文本
  → POST /dsh-voice/chat → 后台人格/路由
      ├─ chat：reply + voice_direction → POST /dsh-voice/tts-stream
      └─ work：语音询问 → 用户确认 → 提交当前 DSH 工作会话
  → 浏览器播放；VAD 检测插话 → 立即停止并重新收音
```

## 关键默认值

| 设置 | 默认 |
|---|---|
| Breeze HTTP | `http://127.0.0.1:8080` |
| 音色 | `dafeiyu`（随包音色库） |
| 随包音色 | `<repo>/assets/voices`（15 个 `.breeze`） |
| ASR 模型 | `<DSH_HOME>/voice-models/asr/model.int8.onnx` |
| ASR tokens | `<DSH_HOME>/voice-models/asr/tokens.txt` |
| 断句静音 | 默认 700 ms；本机可在设置页调整，等待发送以当前配置为准 |
| 最长一句 | 20 s |
| 语速倍率 | 默认 1.0；可在设置页调整 |
| 插话打断 | 开启 |

所有值可在设置页修改，保存到 `%USERPROFILE%\.dsh\dsh-voice-duplex.json`。

## 隐私与边界

- 麦克风音频只在浏览器与本地宿主之间传输；**不上传云端**。
- Breeze HTTP/WS 只绑定 `127.0.0.1`；不要改成 `0.0.0.0`。
- 转写文本进入独立的 `dsh-voice-chat-dafish-v2` 后台语音会话；只有判定为 work 且用户确认后，才提交当前 DSH 工作会话。
- 本插件不做关键词语义路由；任务控制、工具调用仍由 DSH Agent 决定。
- Breeze TTS 2 权重是 **Research & Non-Commercial** 许可：个人使用可以，商用需另行授权。
- 扬声器外放时建议使用耳机或系统回声消除；极强回声仍可能被 VAD 误判。

## 排错

| 现象 | 处理 |
|---|---|
| 没有 🎙 按钮 | 刷新 DSH 页面；确认插件页里 `@local/dsh-voice-duplex` 已启用 |
| 启动提示 Breeze 未运行 | 起 `breeze-server`，或在设置页点「启动 Breeze」 |
| ASR 一直识别中 | 检查 `node` 是否在 PATH、`sherpa-onnx-node` 是否安装、模型路径 |
| 没有声音 | 确认浏览器未拦截自动播放（点一下页面），检查系统输出设备 |
| 说话没反应 | 提高麦克风音量；调低「断句静音」；确认 DSH 已获得麦克风权限 |
| 识别到自己的回声 | 戴耳机；开启系统回声消除；调高插话阈值（后续可加设置） |

## 开发测试

```powershell
node test\host-harness.mjs      # 宿主路由 + Breeze + SenseVoice（mock DSH context）
node test\client-render.cjs     # 客户端组件可渲染
node test\worker-test.cjs       # ASR 子进程单独测试
```

`host-harness` 需要 Breeze 已在 `8080` 运行；识别样本在 `test/fixtures/asr_test16.wav`。

## 许可证

## 许可证

项目代码与随包 `assets/voices/` 音色库按 **MIT** 分发，详见 [LICENSE](LICENSE)；`package.json` 的 `license` 字段为 MIT。

Breeze GGUF 权重不随仓库分发，遵循 **BreezeBlue Research and Non-Commercial License**；Breeze 运行时为 Apache 2.0；SenseVoice 等依赖遵循各自上游许可。完整说明见 [NOTICE.md](NOTICE.md)。
