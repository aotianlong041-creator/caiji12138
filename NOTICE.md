# NOTICE

本项目代码与随包音色库按 MIT 许可分发，详见 `LICENSE`。

## 随包音色库

`assets/voices/` 中的 `.breeze` 文件由项目所有者提供并授权随项目一起开源，按 MIT 许可分发。使用或再分发时仍需确认参考音频、音色样本和相关用途的权利，不得用于冒充真实人物、欺诈或误导。

## 不随包分发的模型与运行时

本仓库不包含以下大文件，安装器从官方发布源下载并校验 SHA-256：

| 组件 | 来源 | 许可/说明 |
| --- | --- | --- |
| Breeze TTS 2 GGUF 权重 | [HoppouAI/Breeze-TTS-2.cpp](https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp) | **BreezeBlue Research and Non-Commercial License**；商用需另行取得授权 |
| Breeze TTS 2 Windows Vulkan 运行时 | [官方 GitHub Release](https://github.com/HoppouAI/Breeze-TTS-2.cpp/releases) | Apache License 2.0 |
| SenseVoice ONNX 与 tokens | [sherpa-onnx SenseVoice 模型](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17) | 遵循模型上游许可；本仓库只提供固定 revision 下载信息 |
| sherpa-onnx-node | npm 依赖 | 遵循其上游许可 |

安装模型前，设置页会要求勾选接受 Breeze 权重的非商用许可。下载地址和固定 SHA-256 记录在 `lib/models.js`。

## 第三方依赖

JavaScript 依赖以 `package.json` / `package-lock.json` 为准；各依赖的许可证归其作者所有。发布二进制或重新分发模型前，请同时保留 `THIRD_PARTY_NOTICES` 等上游声明。
