# 语音陪伴（dsh-voice-companion）

在 DSH Web GUI 里让 Agent **听得到**、也**说得出**：

- 输入框下方多一个「说话」按钮。点一下开始录，再点一下停止，录音会送到本机
  识别器转成文字，**填进输入框**——你可以先改错字再发送。
- 每条助手回复旁多一个「朗读」按钮。点一下，用你选的声音把这条回复读出来；
  再点一下停止。

不需要云端 API key。识别用 Windows 自带的中文语音识别器（离线），
朗读用 `edge-tts`（联网，音色沿用 `zh-CN-XiaoxiaoNeural`，语速 -4%、音高 -7Hz）。

## 依赖（本机已就绪）

| 能力 | 依赖 | 说明 |
| --- | --- | --- |
| 听 | Windows Speech Recognizer `zh-CN` | 系统自带；没有中文语音包时识别器列表为空 |
| 听 | `ffmpeg` | 把浏览器录的 webm/opus 转成 16k 单声道 WAV；这里通过 venv 的 `imageio_ffmpeg` 找到 |
| 说 | Python + `edge-tts` | 工作区 `.venv` 里已有；需要联网 |

自动查找顺序：

- Python：`DSH_VOICE_PYTHON` → `E:\smallDSH\伴侣\.venv\Scripts\python.exe` → `python` → `py`
- ffmpeg：`DSH_VOICE_FFMPEG` → `python -c "import imageio_ffmpeg..."` → `ffmpeg`
- 音色：`DSH_VOICE_NAME` / `DSH_VOICE_RATE` / `DSH_VOICE_PITCH` / `DSH_VOICE_VOLUME`

## 接口

只对本机回环开放：

- `GET /dsh-voice/status` — Python、ffmpeg、音色状态
- `POST /dsh-voice/asr` — 原始音频（webm/ogg/mp4/wav）→ `{ ok, text }`
- `POST /dsh-voice/tts` — `{ sessionId, messageId }` 或 `{ text }` → `{ ok, url }`
- `GET /dsh-voice/audio/<hash>.mp3` — 生成好的语音

TTS 会优先从当前会话里找那条助手消息的正文；找不到就退回该会话最后一条助手消息。
找不到会话时可以用 `{ text }` 直接合成。

## 边界

- **只做 Web GUI**：普通微信的原生语音气泡还没接，微信里发语音仍然要走原来的媒体通道。
- 识别是离线小模型（SAPI），短句和日常口语够用，长句、专有名词会错；
  所以转写只进输入框，不自动发送。
- `edge-tts` 需要联网；断网时「朗读」会报错，录音不受影响。
- 录音最长 30 秒，超过自动停。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host：录音转写、TTS 合成与缓存、音频路由、消息正文查找 |
| `client.js` | 输入框「说话」按钮、回复旁「朗读」按钮 |
| `scripts/asr.ps1` | Windows Speech 识别器封装 |
| `scripts/tts.py` | edge-tts 合成 |
| `locale/*.json` | 插件管理器里的标题与说明 |

缓存目录：`$DSH_HOME/voice-cache`（默认 `~/.dsh/voice-cache`），按文本 + 音色哈希复用。
