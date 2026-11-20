/**
 * 语音陪伴的 Host 半身。
 *
 * - 听：浏览器录音 -> /dsh-voice/asr -> ffmpeg 转 16k 单声道 -> Windows 中文识别器出文字。
 * - 说：/dsh-voice/tts 拿一条回复的文字 -> edge-tts 生成 mp3 -> /dsh-voice/audio/... 播放。
 *
 * 本机实现，不依赖云端 key；edge-tts 需要联网，识别器是 Windows 离线自带的。
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const ROUTE = '/dsh-voice'
const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPTS = join(HERE, 'scripts')
const CACHE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'voice-cache')
const MAX_TEXT = 800
const MAX_AUDIO = 15 * 1024 * 1024

const VOICE = {
  voice: process.env.DSH_VOICE_NAME || 'zh-CN-XiaoxiaoNeural',
  rate: process.env.DSH_VOICE_RATE || '-4%',
  pitch: process.env.DSH_VOICE_PITCH || '-7Hz',
  volume: process.env.DSH_VOICE_VOLUME || '+0%',
}

const PYTHON_CANDIDATES = [
  process.env.DSH_VOICE_PYTHON,
  'E:\\smallDSH\\伴侣\\.venv\\Scripts\\python.exe',
  'python',
  'py',
].filter(Boolean)

let pythonPath = null
let ffmpegPath = null

async function run(file, args, { timeout = 60_000 } = {}) {
  const { stdout, stderr } = await execFileAsync(file, args, {
    timeout,
    killSignal: 'SIGKILL',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  })
  return { stdout: stdout || '', stderr: stderr || '' }
}

async function resolvePython() {
  if (pythonPath) return pythonPath
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      await run(candidate, ['-c', 'import edge_tts'], { timeout: 20_000 })
      pythonPath = candidate
      return candidate
    } catch {
      // 试下一个。
    }
  }
  throw new Error('找不到带 edge-tts 的 Python。请设置 DSH_VOICE_PYTHON 指向它。')
}

async function resolveFfmpeg() {
  if (ffmpegPath) return ffmpegPath
  const candidates = []
  if (process.env.DSH_VOICE_FFMPEG) candidates.push(process.env.DSH_VOICE_FFMPEG)
  try {
    const python = await resolvePython()
    const { stdout } = await run(python, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { timeout: 20_000 })
    const found = stdout.trim().split(/\r?\n/).filter(Boolean).pop()
    if (found) candidates.push(found)
  } catch {
    // 没有 imageio_ffmpeg 就继续找 PATH。
  }
  candidates.push('ffmpeg')
  for (const candidate of candidates) {
    try {
      await run(candidate, ['-version'], { timeout: 15_000 })
      ffmpegPath = candidate
      return candidate
    } catch {
      // 试下一个。
    }
  }
  throw new Error('找不到 ffmpeg。请设置 DSH_VOICE_FFMPEG。')
}

function textBlocks(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function assistantTextFromEvents(events, messageId) {
  let fallback = ''
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (!event || event.type !== 'assistant/message') continue
    const message = event.data?.message ?? event.data
    if (!message || message.role !== 'assistant') continue
    const text = textBlocks(message.content)
    if (!text) continue
    if (!fallback) fallback = text
    if (messageId && message.id === messageId) return text
  }
  return fallback
}

function textFromMessage(message) {
  if (!message) return ''
  return textBlocks(message.content)
}

function findInMessages(messages, messageId) {
  let fallback = ''
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.role !== 'assistant') continue
    const text = textFromMessage(message)
    if (!text) continue
    if (!fallback) fallback = text
    if (messageId && message.id === messageId) return text
  }
  return fallback
}

async function speechTextFor(ctx, body) {
  const direct = typeof body.text === 'string' ? body.text : ''
  if (direct.trim()) return direct
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  const messageId = typeof body.messageId === 'string' ? body.messageId : ''
  if (!sessionId) return ''

  // 1. Live session in this process: its message projection has the id the UI passes.
  const sessions = ctx.get('sessions')
  const session = sessions?.get?.(sessionId)
  if (session) {
    try {
      if (typeof session.deriveMessages === 'function') {
        const found = findInMessages(session.deriveMessages(), messageId)
        if (found) return found
      }
    } catch {
      // 投影读不到就走事件。
    }
    try {
      const events = typeof session.snapshotEvents === 'function'
        ? session.snapshotEvents()
        : Array.isArray(session.events) ? session.events : []
      const found = assistantTextFromEvents(events, messageId)
      if (found) return found
    } catch {
      // 继续走持久层。
    }
  }

  // 2. A closed session still on disk: open it read-only and scan the log.
  const persistence = ctx.get('sessionPersistence')
  if (persistence && typeof persistence.open === 'function') {
    let handle
    try {
      handle = await persistence.open(sessionId, 'read')
      const result = await handle.read(0)
      if (Array.isArray(result?.events)) return assistantTextFromEvents(result.events, messageId)
    } catch {
      // 读不到就交给上层报错。
    } finally {
      try {
        await handle?.close?.()
      } catch {
        // 已经关了。
      }
    }
  }
  return ''
}

function cleanSpeech(raw) {
  return String(raw)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#>~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT)
}

async function synthesize(text) {
  const speech = cleanSpeech(text)
  if (!speech) throw new Error('没有可朗读的文字')
  mkdirSync(CACHE, { recursive: true })
  const key = createHash('sha256').update(`${VOICE.voice}|${VOICE.rate}|${VOICE.pitch}|${speech}`).digest('hex').slice(0, 32)
  const file = join(CACHE, `${key}.mp3`)
  if (existsSync(file) && statSync(file).size > 500) return { speech, key, cached: true }

  const python = await resolvePython()
  const output = join(CACHE, `${key}.${process.pid}.${Date.now()}.part.mp3`)
  const request = join(tmpdir(), `dsh-voice-tts-${process.pid}-${Date.now()}.json`)
  writeFileSync(request, JSON.stringify({ text: speech, output, ...VOICE }), 'utf8')
  try {
    try {
      await run(python, [join(SCRIPTS, 'tts.py'), request], { timeout: 120_000 })
    } catch (error) {
      const detail = [error?.stdout, error?.stderr, error?.message]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300)
      throw new Error(`TTS 失败：${detail}`)
    }
    if (!existsSync(output) || statSync(output).size < 500) throw new Error('TTS 没有生成有效音频')
    try {
      renameSync(output, file)
    } catch {
      try {
        unlinkSync(output)
      } catch {
        // 清不掉就算了。
      }
    }
  } finally {
    try {
      unlinkSync(request)
    } catch {
      // 已经删了。
    }
    try {
      if (existsSync(output)) unlinkSync(output)
    } catch {
      // 已经搬走了。
    }
  }
  return { speech, key, cached: false }
}

function audioExtension(contentType) {
  if (/webm/i.test(contentType)) return '.webm'
  if (/wav/i.test(contentType)) return '.wav'
  if (/ogg/i.test(contentType)) return '.ogg'
  if (/mp4|m4a|aac/i.test(contentType)) return '.m4a'
  return '.webm'
}

async function transcribe(buffer, contentType) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-voice-asr-'))
  try {
    const input = join(directory, `input${audioExtension(contentType)}`)
    const wav = join(directory, 'speech.wav')
    writeFileSync(input, buffer)
    const ffmpeg = await resolveFfmpeg()
    await run(ffmpeg, [
      '-y', '-loglevel', 'error', '-i', input,
      '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', wav,
    ], { timeout: 60_000 })
    const powershell = process.env.DSH_VOICE_POWERSHELL || 'powershell.exe'
    const { stdout } = await run(powershell, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(SCRIPTS, 'asr.ps1'), '-Wav', wav,
    ], { timeout: 30_000 })
    const line = stdout.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean).pop() || '{}'
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new Error('识别器返回了无法解析的结果')
    }
    if (!parsed.ok) throw new Error(parsed.error || '识别失败')
    return String(parsed.text || '').trim()
  } finally {
    try {
      rmSync(directory, { recursive: true, force: true })
    } catch {
      // 临时目录清不掉也不影响结果。
    }
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function serveAudio(pathname, res) {
  const name = decodeURIComponent(pathname.slice(`${ROUTE}/audio/`.length))
  if (!/^[a-f0-9]{32}\.mp3$/.test(name)) {
    sendJson(res, 404, { ok: false, error: 'not found' })
    return
  }
  const file = join(CACHE, name)
  if (!existsSync(file)) {
    sendJson(res, 404, { ok: false, error: 'not found' })
    return
  }
  const bytes = readFileSync(file)
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Content-Length': String(bytes.length),
    'Cache-Control': 'public, max-age=86400',
  })
  res.end(bytes)
}

async function status() {
  const result = { ok: true, voice: VOICE, python: false, ffmpeg: false, recognizer: 'Windows zh-CN Speech' }
  try {
    await resolvePython()
    result.python = true
  } catch {
    // 保持 false，让面板知道原因。
  }
  try {
    await resolveFfmpeg()
    result.ffmpeg = true
  } catch {
    // 同上。
  }
  return result
}

async function handleRequest(ctx, req, res) {
  const remote = String(req.socket?.remoteAddress || '')
  const loopback = !remote || remote === '::1' || remote === '127.0.0.1' || remote === '::ffff:127.0.0.1'
  if (!loopback) {
    sendJson(res, 403, { ok: false, error: 'loopback only' })
    return
  }

  const pathname = new URL(req.url || '/', 'http://localhost').pathname

  if (req.method === 'GET' && pathname === `${ROUTE}/status`) {
    try {
      sendJson(res, 200, await status())
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error?.message || error) })
    }
    return
  }

  if (req.method === 'GET' && pathname.startsWith(`${ROUTE}/audio/`)) {
    serveAudio(pathname, res)
    return
  }

  if (req.method === 'POST' && pathname === `${ROUTE}/tts`) {
    try {
      const raw = await readBody(req, 256 * 1024)
      let body = {}
      try {
        body = JSON.parse(raw.toString('utf8') || '{}')
      } catch {
        sendJson(res, 400, { ok: false, error: 'invalid json' })
        return
      }
      const text = await speechTextFor(ctx, body)
      if (!text.trim()) {
        sendJson(res, 404, { ok: false, error: '没有找到要读的回复' })
        return
      }
      const result = await synthesize(text)
      sendJson(res, 200, {
        ok: true,
        url: `${ROUTE}/audio/${result.key}.mp3`,
        speech: result.speech,
        cached: result.cached,
      })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error?.message || error) })
    }
    return
  }

  if (req.method === 'POST' && pathname === `${ROUTE}/asr`) {
    try {
      const raw = await readBody(req, MAX_AUDIO)
      if (raw.length < 1000) {
        sendJson(res, 400, { ok: false, error: '录音太短' })
        return
      }
      const text = await transcribe(raw, String(req.headers['content-type'] || ''))
      if (!text) {
        sendJson(res, 200, { ok: false, error: '没有听清' })
        return
      }
      sendJson(res, 200, { ok: true, text })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error?.message || error) })
    }
    return
  }

  sendJson(res, 404, { ok: false, error: 'not found' })
}

export function apply(ctx) {
  let disposeRoute = null
  const stopInjection = ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.get?.('webServer') ?? webCtx.webServer
    if (!webServer) return
    disposeRoute = webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: (req, res) => {
        handleRequest(ctx, req, res).catch((error) => {
          try {
            sendJson(res, 500, { ok: false, error: String(error?.message || error) })
          } catch {
            // 响应已经结束。
          }
        })
      },
    })
  })
  ctx.effect(() => () => {
    if (typeof stopInjection === 'function') stopInjection()
    if (disposeRoute) {
      try {
        disposeRoute()
      } catch {
        // 重复注销不致命。
      }
    }
  })
}
