import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { cpus, homedir, totalmem } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const MODEL_VARIANTS = Object.freeze([
  {
    id: 'q4_k',
    label: 'Q4_K',
    file: 'breeze-tts-2-q4_k.gguf',
    bytes: 2538909376,
    sha256: '483418fbbb438f5f1c08dbe2b017e42db0f1d126765cd3f772d8622a30a4915c',
    vramGB: 3,
    quality: '体积最小，适合 3–4 GB 显存或 CPU 回退；短句自然度足够，长文细节较弱。',
  },
  {
    id: 'q6_k',
    label: 'Q6_K',
    file: 'breeze-tts-2-q6_k.gguf',
    bytes: 3069969664,
    sha256: '0eb51de6cbccd54b1c408198797254ac46b3cbd55ca1174c630eaac6d01064d3',
    vramGB: 3.5,
    quality: '3.5–4 GB 显存；质量和速度的折中。',
  },
  {
    id: 'q8_0',
    label: 'Q8_0',
    file: 'breeze-tts-2-q8_0.gguf',
    bytes: 3568844480,
    sha256: 'a02bcc4b69b0601032727f8040c4942149b1b73aa0f69022fe5aaa6a8f0ef879',
    vramGB: 4,
    quality: '官方推荐；4 GB 以上显存，稳定性和音质更稳。',
  },
  {
    id: 'f16',
    label: 'F16',
    file: 'breeze-tts-2-f16.gguf',
    bytes: 6279630784,
    sha256: 'db740cd464d75f2635a891586f083c5b466fd63542bebd957fe7890324b04c35',
    vramGB: 7,
    quality: '参考质量，约 7 GB 显存；下载和加载都最重。',
  },
])

export const BREEZE_RUNTIME = Object.freeze({
  version: 'v0.1.3',
  platform: 'win32-x64',
  file: 'breeze-tts-2-v0.1.3-windows-x64-vulkan.zip',
  bytes: 73939562,
  sha256: 'd31feee5380e0609dc44b537d22cbe4f3cf8e93495756f3a580d8b448db79f7f',
  url: 'https://github.com/HoppouAI/Breeze-TTS-2.cpp/releases/download/v0.1.3/breeze-tts-2-v0.1.3-windows-x64-vulkan.zip',
  binary: 'breeze-server.exe',
})

export const ASR_ASSETS = Object.freeze({
  model: {
    name: 'model.int8.onnx',
    bytes: 239233841,
    sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
    url: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx',
  },
  tokens: {
    name: 'tokens.txt',
    bytes: 315894,
    sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
    url: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt',
  },
})

const HOST_MODEL_BASE = 'https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp/resolve/main/'

export function defaultModelDir(dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  return join(dshHome, 'voice-models')
}

export function modelFor(id) {
  return MODEL_VARIANTS.find(item => item.id === id)
}

export function modelPath(modelDir, id) {
  const variant = modelFor(id)
  if (!variant) throw new Error(`未知模型：${id}`)
  return join(resolve(modelDir), variant.file)
}

export function runtimePath(modelDir) {
  return join(resolve(modelDir), `breeze-${BREEZE_RUNTIME.version}-${BREEZE_RUNTIME.platform}`)
}

export function asrPaths(modelDir) {
  return {
    model: join(resolve(modelDir), 'asr', ASR_ASSETS.model.name),
    tokens: join(resolve(modelDir), 'asr', ASR_ASSETS.tokens.name),
  }
}

function fileExists(file) {
  try { return statSync(file).isFile() } catch { return false }
}

export function installedState(modelDir, bundledVoicesDir, active = {}) {
  const activeModel = String(active.breezeModelPath || '')
  const models = MODEL_VARIANTS.map(item => ({
    id: item.id,
    file: join(resolve(modelDir), item.file),
    active: Boolean(activeModel && basename(activeModel) === item.file && fileExists(activeModel)),
    installed: fileExists(join(resolve(modelDir), item.file))
      || Boolean(activeModel && basename(activeModel) === item.file && fileExists(activeModel)),
  }))
  const runtimeBinary = join(runtimePath(modelDir), BREEZE_RUNTIME.binary)
  const asr = asrPaths(modelDir)
  return {
    modelDir: resolve(modelDir),
    models,
    runtime: {
      path: runtimeBinary,
      activePath: active.breezeServerPath || '',
      installed: fileExists(runtimeBinary) || Boolean(active.breezeServerPath && fileExists(active.breezeServerPath)),
    },
    asr: {
      model: {
        path: asr.model,
        activePath: active.asrModelPath || '',
        installed: fileExists(asr.model) || Boolean(active.asrModelPath && fileExists(active.asrModelPath)),
      },
      tokens: {
        path: asr.tokens,
        activePath: active.asrTokensPath || '',
        installed: fileExists(asr.tokens) || Boolean(active.asrTokensPath && fileExists(active.asrTokensPath)),
      },
    },
    voices: {
      path: bundledVoicesDir || '',
      activePath: active.breezeVoicesDir || '',
      installed: Boolean(bundledVoicesDir && existsSync(bundledVoicesDir))
        || Boolean(active.breezeVoicesDir && existsSync(active.breezeVoicesDir)),
      bundled: true,
    },
  }
}

async function gpuInfo() {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=name,memory.total',
      '--format=csv,noheader,nounits',
    ], { timeout: 2500, windowsHide: true })
    const rows = String(stdout || '').trim().split(/\r?\n/).filter(Boolean)
    if (rows.length > 0) {
      const [name, memory] = rows[0].split(',').map(value => value.trim())
      return { name, vramGB: Math.round((Number(memory) / 1024) * 10) / 10 }
    }
  } catch {}
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name',
      ], { timeout: 2500, windowsHide: true })
      const name = String(stdout || '').trim()
      if (name && !/Microsoft Basic|Remote Display/i.test(name)) return { name, vramGB: null }
    } catch {}
  }
  return null
}

export async function detectHardware() {
  const cpuList = cpus()
  const ramGB = Math.round((totalmem() / 1024 ** 3) * 10) / 10
  const gpu = await gpuInfo()
  const vram = Number(gpu?.vramGB)
  let recommended = 'q4_k'
  let reason = '未检测到可用显存；Q4_K 体积最小，适合 CPU 回退。'
  if (Number.isFinite(vram) && vram >= 7) {
    recommended = 'f16'
    reason = `检测到 ${vram} GB 显存，可选 F16 参考质量。`
  } else if (Number.isFinite(vram) && vram >= 4) {
    recommended = 'q8_0'
    reason = `检测到 ${vram} GB 显存，推荐官方 Q8_0。`
  } else if (Number.isFinite(vram) && vram >= 3.5) {
    recommended = 'q6_k'
    reason = `检测到 ${vram} GB 显存，推荐 Q6_K 折中。`
  } else if (Number.isFinite(vram) && vram >= 3) {
    recommended = 'q4_k'
    reason = `检测到 ${vram} GB 显存，推荐 Q4_K。`
  } else if (ramGB < 8) {
    reason = `内存约 ${ramGB} GB，建议 Q4_K 并关闭其他大程序。`
  }
  return {
    platform: process.platform,
    arch: process.arch,
    cpu: cpuList?.[0]?.model || 'unknown',
    cpuThreads: cpuList?.length || 1,
    ramGB,
    gpu,
    recommended,
    reason,
  }
}

async function verifyFile(file, asset) {
  if (!fileExists(file)) return false
  try {
    if (statSync(file).size !== asset.bytes) return false
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    return hash.digest('hex') === asset.sha256
  } catch { return false }
}

async function downloadAsset(asset, destination, signal, progress) {
  if (await verifyFile(destination, asset)) return { path: destination, skipped: true }
  mkdirSync(dirname(destination), { recursive: true })
  const partial = `${destination}.part`
  try { rmSync(partial, { force: true }) } catch {}
  let response
  try {
    response = await fetch(asset.url, { signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(`下载 ${asset.name} 失败：${error instanceof Error ? error.message : String(error)}。请检查网络或全局代理，或按此地址手动下载：${asset.url}`)
  }
  if (!response.ok || !response.body) {
    throw new Error(`下载 ${asset.name} 失败：HTTP ${response.status}。请检查网络或全局代理；官方地址：${asset.url}`)
  }
  const total = Number(response.headers.get('content-length')) || asset.bytes
  const hash = createHash('sha256')
  let completed = 0
  const file = createWriteStream(partial)
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk)
      completed += bytes.length
      hash.update(bytes)
      if (!file.write(bytes)) await new Promise(resolve => file.once('drain', resolve))
      progress?.({ phase: 'downloading', name: asset.name, completedBytes: completed, totalBytes: total })
    }
    await new Promise((resolve, reject) => file.end(error => error ? reject(error) : resolve()))
    const digest = hash.digest('hex')
    if (completed !== asset.bytes || digest !== asset.sha256) {
      throw new Error(`${asset.name} 校验失败（size/hash 不匹配）`)
    }
    renameSync(partial, destination)
    return { path: destination, skipped: false }
  } catch (error) {
    try { file.destroy() } catch {}
    try { rmSync(partial, { force: true }) } catch {}
    throw error
  }
}

async function extractZip(zipPath, destination, signal) {
  mkdirSync(destination, { recursive: true })
  if (process.platform === 'win32') {
    await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`,
    ], { timeout: 120_000, windowsHide: true, signal })
  } else {
    await execFileAsync('unzip', ['-o', zipPath, '-d', destination], { timeout: 120_000, signal })
  }
}

function findBinary(root, name) {
  if (!existsSync(root)) return ''
  const queue = [root]
  while (queue.length) {
    const current = queue.shift()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) queue.push(full)
      else if (entry.name.toLowerCase() === name.toLowerCase()) return full
    }
  }
  return ''
}

export async function installPlan({ modelId, modelDir, installRuntime = true, installAsr = true, bundledVoicesDir }, signal, progress) {
  const variant = modelFor(modelId)
  if (!variant) throw new Error(`未知模型：${modelId}`)
  if (process.platform !== 'win32' && installRuntime) {
    throw new Error('自动安装运行时目前只支持 Windows x64；请手动安装 Breeze 运行时或关闭运行时安装')
  }
  const dir = resolve(modelDir || defaultModelDir())
  const selectedModel = modelPath(dir, modelId)
  const operations = [{
    kind: 'model',
    name: variant.file,
    done: false,
    path: selectedModel,
    bytes: variant.bytes,
    url: HOST_MODEL_BASE + variant.file,
    sha256: variant.sha256,
  }]
  if (installRuntime) operations.push({
    kind: 'runtime',
    name: BREEZE_RUNTIME.file,
    done: false,
    skipped: Boolean(findBinary(runtimePath(dir), BREEZE_RUNTIME.binary)),
    bytes: BREEZE_RUNTIME.bytes,
    url: BREEZE_RUNTIME.url,
    sha256: BREEZE_RUNTIME.sha256,
  })
  if (installAsr) {
    operations.push({ kind: 'asr-model', ...ASR_ASSETS.model })
    operations.push({ kind: 'asr-tokens', ...ASR_ASSETS.tokens })
  }
  progress?.({ phase: 'plan', operations, modelDir: dir })
  for (const operation of operations) {
    signal?.throwIfAborted()
    if (operation.kind === 'model') {
      await downloadAsset(operation, selectedModel, signal, progress)
      operation.done = true
      progress?.({ phase: 'installed', kind: 'model', name: operation.name })
    } else if (operation.kind === 'asr-model' || operation.kind === 'asr-tokens') {
      const asr = asrPaths(dir)
      await downloadAsset(operation, operation.kind === 'asr-model' ? asr.model : asr.tokens, signal, progress)
      operation.done = true
      progress?.({ phase: 'installed', kind: operation.kind, name: operation.name })
    } else if (operation.kind === 'runtime') {
      const runtimeDir = runtimePath(dir)
      const existingBinary = findBinary(runtimeDir, BREEZE_RUNTIME.binary)
      if (existingBinary) {
        operation.done = true
        progress?.({ phase: 'installed', kind: 'runtime', name: operation.name, binary: existingBinary, skipped: true })
        continue
      }
      const zip = join(dir, BREEZE_RUNTIME.file)
      await downloadAsset(operation, zip, signal, progress)
      await extractZip(zip, runtimeDir, signal)
      const binary = findBinary(runtimeDir, BREEZE_RUNTIME.binary)
      if (!binary) throw new Error('运行时已下载，但没有找到 breeze-server.exe')
      operation.done = true
      progress?.({ phase: 'installed', kind: 'runtime', name: operation.name, binary })
    }
  }
  const asr = asrPaths(dir)
  return {
    modelDir: dir,
    breezeModelPath: selectedModel,
    breezeServerPath: installRuntime ? findBinary(runtimePath(dir), BREEZE_RUNTIME.binary) : '',
    asrModelPath: installAsr ? asr.model : '',
    asrTokensPath: installAsr ? asr.tokens : '',
    breezeVoicesDir: bundledVoicesDir || '',
    installed: installedState(dir, bundledVoicesDir),
  }
}
