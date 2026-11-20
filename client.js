window.__ModuleLoader__.load({
  id: 'dsh-voice-companion',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-voice'

    const zh = {
      'voice.talk': '说话',
      'voice.listening': '正在听',
      'voice.transcribing': '识别中',
      'voice.inserted': '已经放进输入框',
      'voice.tooShort': '太短了，再说一次',
      'voice.micDenied': '没拿到麦克风权限',
      'voice.asrFailed': '没听清，再说一次',
      'voice.speak': '朗读',
      'voice.playing': '正在读，点一下停',
      'voice.ttsFailed': '这次没读出来',
      'voice.micAria': '按住说话，录完自动转文字',
    }

    const en = {
      'voice.talk': 'Talk',
      'voice.listening': 'Listening',
      'voice.transcribing': 'Transcribing',
      'voice.inserted': 'Added to the composer',
      'voice.tooShort': 'Too short, try again',
      'voice.micDenied': 'Microphone permission denied',
      'voice.asrFailed': 'Did not catch that, try again',
      'voice.speak': 'Read aloud',
      'voice.playing': 'Reading, click to stop',
      'voice.ttsFailed': 'Could not read this one',
      'voice.micAria': 'Click to talk; the transcript goes into the composer',
    }

    const CSS = `
.dsh-voice-dock { display:flex; align-items:center; gap:8px; min-width:0; }
.dsh-voice-pill { display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 10px; border-radius:999px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; line-height:1; cursor:pointer; transition:background .15s ease, border-color .15s ease, color .15s ease; }
.dsh-voice-pill:hover { background:var(--dsw-alias-bg-layer-2); border-color:var(--dsw-alias-border-l2); color:var(--dsw-alias-label-primary); }
.dsh-voice-pill[data-phase="recording"] { color:var(--dsw-alias-state-error-primary); border-color:var(--dsw-alias-state-error-primary); }
.dsh-voice-pill[data-phase="error"] { color:var(--dsw-alias-state-warn-primary); }
.dsh-voice-pill:disabled { opacity:.6; cursor:default; }
.dsh-voice-dot { width:8px; height:8px; border-radius:50%; background:var(--dsw-alias-state-error-primary); animation:dsh-voice-pulse 1s ease-in-out infinite; }
.dsh-voice-notice { font-size:11px; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; }
@keyframes dsh-voice-pulse { 0%,100% { opacity:1; transform:scale(1) } 50% { opacity:.45; transform:scale(.8) } }
.dsh-voice-action { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; }
.dsh-voice-action:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
.dsh-voice-action[data-phase="error"] { color:var(--dsw-alias-state-warn-primary); }
.dsh-voice-spinner { width:14px; height:14px; border:2px solid var(--dsw-alias-border-l1); border-top-color:var(--dsw-alias-label-secondary); border-radius:50%; animation:dsh-voice-spin .8s linear infinite; }
@keyframes dsh-voice-spin { to { transform:rotate(360deg) } }
@media (prefers-reduced-motion: reduce) {
  .dsh-voice-dot, .dsh-voice-spinner { animation:none !important; }
}
`

    const MIME_TYPES = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ]

    function pickMime() {
      try {
        return MIME_TYPES.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || ''
      } catch {
        return ''
      }
    }

    function MicIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z', fill: 'currentColor' }),
        h('path', { d: 'M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }))
    }

    function SpeakerIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M4 9.25h3.2L12 5.5v13L7.2 14.75H4a1 1 0 0 1-1-1v-3.5a1 1 0 0 1 1-1Z', fill: 'currentColor' }),
        h('path', { d: 'M15 9.2a4.2 4.2 0 0 1 0 5.6M17.6 6.6a8 8 0 0 1 0 10.8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }))
    }

    function StopIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2, fill: 'currentColor' }))
    }

    function formatSeconds(total) {
      const safe = Math.max(0, Math.floor(total))
      return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
    }

    function insertIntoComposer(inputActions, draft, text) {
      let inserted = false
      try {
        if (inputActions && typeof inputActions.captureInsertion === 'function' && typeof inputActions.insertText === 'function') {
          inserted = inputActions.insertText(text, inputActions.captureInsertion()) === true
        }
      } catch {
        inserted = false
      }
      if (!inserted) {
        try {
          const current = typeof draft === 'string' ? draft : ''
          inputActions?.setDraft?.(current.trim() ? `${current}\n${text}` : text)
        } catch {
          // 输入框 API 变了也不能让录音白费。
        }
      }
      try {
        document.querySelector('[data-composer-card] [contenteditable="true"]')?.focus()
      } catch {
        // 纯增强。
      }
    }

    function VoiceDock({ t, inputActions, useInput }) {
      const tr = typeof t === 'function' ? t : (key) => key
      const inputState = typeof useInput === 'function' ? useInput((state) => state) : null
      const draft = inputState && typeof inputState.draft === 'string' ? inputState.draft : ''
      const draftRef = React.useRef(draft)
      draftRef.current = draft

      const [phase, setPhase] = React.useState('idle')
      const [notice, setNotice] = React.useState('')
      const [seconds, setSeconds] = React.useState(0)
      const recorderRef = React.useRef(null)
      const streamRef = React.useRef(null)
      const chunksRef = React.useRef([])
      const aliveRef = React.useRef(true)
      const busyRef = React.useRef(false)
      const limitTimerRef = React.useRef(null)
      const tickTimerRef = React.useRef(null)
      const noticeTimerRef = React.useRef(null)

      const stopTimers = () => {
        if (limitTimerRef.current) clearTimeout(limitTimerRef.current)
        if (tickTimerRef.current) clearInterval(tickTimerRef.current)
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
        limitTimerRef.current = null
        tickTimerRef.current = null
        noticeTimerRef.current = null
      }

      React.useEffect(() => () => {
        aliveRef.current = false
        stopTimers()
        try {
          const recorder = recorderRef.current
          if (recorder && recorder.state !== 'inactive') recorder.stop()
        } catch {
          // 卸载时停止失败无所谓。
        }
        try {
          streamRef.current?.getTracks().forEach((track) => track.stop())
        } catch {
          // 同上。
        }
      }, [])

      const finish = (nextPhase, nextNotice) => {
        if (!aliveRef.current) return
        setPhase(nextPhase)
        setNotice(nextNotice || '')
        if (nextNotice) {
          noticeTimerRef.current = setTimeout(() => {
            if (aliveRef.current) setNotice('')
          }, 3500)
        }
      }

      const stop = () => {
        try {
          const recorder = recorderRef.current
          if (recorder && recorder.state !== 'inactive') recorder.stop()
        } catch {
          // 已经停了。
        }
      }

      const start = async () => {
        if (busyRef.current) return
        if (recorderRef.current && recorderRef.current.state === 'recording') {
          stop()
          return
        }
        if (typeof window.MediaRecorder !== 'function' || !navigator.mediaDevices?.getUserMedia) {
          finish('error', tr('voice.micDenied'))
          return
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          })
          if (!aliveRef.current) {
            stream.getTracks().forEach((track) => track.stop())
            return
          }
          const mime = pickMime()
          let recorder
          try {
            recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
          } catch {
            recorder = new MediaRecorder(stream)
          }
          chunksRef.current = []
          recorderRef.current = recorder
          streamRef.current = stream
          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
          }
          recorder.onstop = async () => {
            stopTimers()
            const type = recorder.mimeType || mime || 'audio/webm'
            const blob = new Blob(chunksRef.current, { type })
            chunksRef.current = []
            try {
              streamRef.current?.getTracks().forEach((track) => track.stop())
            } catch {
              // 已经释放。
            }
            streamRef.current = null
            recorderRef.current = null
            if (!aliveRef.current) return
            if (blob.size < 1200) {
              finish('error', tr('voice.tooShort'))
              return
            }
            busyRef.current = true
            finish('busy', tr('voice.transcribing'))
            try {
              const response = await fetch('/dsh-voice/asr', {
                method: 'POST',
                headers: { 'content-type': type },
                body: blob,
              })
              const payload = await response.json().catch(() => ({}))
              if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`)
              const text = String(payload.text || '').trim()
              if (!text) throw new Error('empty transcript')
              insertIntoComposer(inputActions, draftRef.current, text)
              finish('idle', tr('voice.inserted'))
            } catch {
              finish('error', tr('voice.asrFailed'))
            } finally {
              busyRef.current = false
            }
          }
          recorder.start(250)
          setSeconds(0)
          finish('recording', '')
          tickTimerRef.current = setInterval(() => {
            if (aliveRef.current) setSeconds((value) => value + 1)
          }, 1000)
          limitTimerRef.current = setTimeout(() => {
            if (aliveRef.current) stop()
          }, 30000)
        } catch {
          finish('error', tr('voice.micDenied'))
        }
      }

      const label = phase === 'recording'
        ? `${tr('voice.listening')} ${formatSeconds(seconds)}`
        : phase === 'busy'
          ? tr('voice.transcribing')
          : tr('voice.talk')

      return h('div', { className: 'dsh-voice-dock' },
        h('button', {
          type: 'button',
          className: 'dsh-voice-pill',
          'data-phase': phase,
          'aria-pressed': phase === 'recording',
          'aria-label': tr('voice.micAria'),
          title: tr('voice.micAria'),
          disabled: phase === 'busy',
          onClick: start,
        },
        phase === 'recording' ? h('span', { className: 'dsh-voice-dot' }) : h(MicIcon),
        h('span', null, label)),
        notice ? h('span', { className: 'dsh-voice-notice', role: 'status' }, notice) : null)
    }

    function SpeakAction({ t, sessionId, messageId }) {
      const tr = typeof t === 'function' ? t : (key) => key
      const [phase, setPhase] = React.useState('idle')
      const audioRef = React.useRef(null)
      const aliveRef = React.useRef(true)
      const resetTimerRef = React.useRef(null)

      React.useEffect(() => () => {
        aliveRef.current = false
        if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
        try {
          audioRef.current?.pause()
        } catch {
          // 卸载时停不掉无所谓。
        }
      }, [])

      const stop = () => {
        try {
          audioRef.current?.pause()
        } catch {
          // 已经停了。
        }
        audioRef.current = null
        if (aliveRef.current) setPhase('idle')
      }

      const play = async () => {
        if (phase === 'playing') {
          stop()
          return
        }
        if (phase === 'loading') return
        setPhase('loading')
        try {
          const response = await fetch('/dsh-voice/tts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, messageId }),
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok || !payload.ok || !payload.url) {
            throw new Error(payload.error || `HTTP ${response.status}`)
          }
          const audio = new Audio(payload.url)
          audioRef.current = audio
          audio.onended = () => {
            if (aliveRef.current) setPhase('idle')
          }
          audio.onerror = () => {
            if (aliveRef.current) setPhase('error')
          }
          await audio.play()
          if (aliveRef.current) setPhase('playing')
        } catch {
          if (!aliveRef.current) return
          setPhase('error')
          resetTimerRef.current = setTimeout(() => {
            if (aliveRef.current) setPhase('idle')
          }, 2500)
        }
      }

      const title = phase === 'playing' ? tr('voice.playing') : phase === 'error' ? tr('voice.ttsFailed') : tr('voice.speak')
      return h('button', {
        type: 'button',
        className: 'dsh-voice-action',
        'data-phase': phase,
        'aria-label': title,
        title,
        onClick: play,
      },
      phase === 'loading'
        ? h('span', { className: 'dsh-voice-spinner' })
        : phase === 'playing'
          ? h(StopIcon)
          : h(SpeakerIcon))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }))
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-voice', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        })
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'voice',
          order: 35,
          locale: NS,
        }, VoiceDock))
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'voice',
          order: 30,
          locale: NS,
        }, SpeakAction))
      },
    }
  },
})
