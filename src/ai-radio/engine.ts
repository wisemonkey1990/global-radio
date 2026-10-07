// Radio engine: owns the AudioContext, the radio chain, the stream / house-band / local
// sources, sleep timer, and the reactive state the UI renders.

import { reactive, watch } from 'vue'
import { DEFAULT_FX, createAmRadio, type AmRadio, type RadioFx, type RadioMode } from './audio/amRadio'
import { startGenerative, type Generative } from './audio/generative'
import { FREQ_MAX, FREQ_MIN, LOCK_WINDOW, PRESETS, SLEEP_STEPS, THEMES, type Lang, type PresetId, type Theme } from './data'
import { curatedFor, lastStation, loadDirectory, probeStream, rememberStation, type Station } from './stations'

const STORE_KEY = 'ai-radio:v1'
const STREAM_TIMEOUT_MS = 9000
const PROBE_TIMEOUT_MS = 4000
const PROBE_BATCH = 4
const STALL_TIMEOUT_MS = 12000
const MAX_ATTEMPTS = 10

interface Saved {
  preset: PresetId
  freq: number
  mode: RadioMode
  lang: Lang
  mains: 50 | 60
  fx: RadioFx
  theme: Theme
}

function load(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
  } catch {
    return {}
  }
}

const saved = load()

function initialFreq() {
  const preset = PRESETS.find((p) => p.id === saved.preset) ?? PRESETS[0]
  const f = saved.freq
  if (typeof f !== 'number' || f < FREQ_MIN || f > FREQ_MAX) return preset.freq
  // channels were re-spaced when the eighth was added: a saved dial position that isn't on any channel
  // any more starts on the saved channel instead of between stations
  return PRESETS.some((p) => Math.abs(p.freq - f) <= LOCK_WINDOW) ? Math.round(f * 10) / 10 : preset.freq
}

export const state = reactive({
  preset: (PRESETS.some((p) => p.id === saved.preset) ? saved.preset : 'mood') as PresetId,
  freq: initialFreq(),
  locked: false,
  mode: (['clean', 'mw', 'tube'].includes(saved.mode as string) ? saved.mode : 'mw') as RadioMode,
  lang: (saved.lang === 'en' ? 'en' : 'zh') as Lang,
  mains: (saved.mains === 60 ? 60 : 50) as 50 | 60,
  /** adjustable character of the radio, see RadioFx */
  fx: { ...DEFAULT_FX, ...saved.fx } as RadioFx,
  theme: (THEMES.some((t) => t.id === saved.theme) ? saved.theme : 'dark') as Theme,

  playing: false,
  /** true from tuning until the first sound of the new station arrives */
  tuning: false,
  /** 'static' = the dial is between stations: only radio noise */
  source: '' as '' | 'stream' | 'house' | 'local' | 'static',
  /** name of the station currently on the air (stream source) */
  station: '',
  note: '',
  /** 1..5 bars */
  signal: 5,
  elapsed: 0,
  sleepMin: 0,
  sleepLeft: 0,
  /** recent audio events, shown in Settings → 诊断信息 to help debug device-specific problems */
  log: [] as string[],
})

{
  const hit = PRESETS.find((p) => Math.abs(p.freq - state.freq) <= LOCK_WINDOW)
  if (hit) {
    state.freq = hit.freq
    state.preset = hit.id
    state.locked = true
  }
}

watch(
  () => [state.preset, state.freq, state.mode, state.lang, state.mains, state.fx, state.theme],
  () => {
    const out: Saved = {
      preset: state.preset,
      freq: state.freq,
      mode: state.mode,
      lang: state.lang,
      mains: state.mains,
      fx: state.fx,
      theme: state.theme,
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(out))
    } catch {
      /* storage unavailable */
    }
  },
  { deep: true },
)

// ------------------------------------------------------------------ theme
/** Apply the theme before the first paint (this module is imported before the app mounts). */
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES.find((t) => t.id === theme)?.color ?? '#1b1b1b')
}
applyTheme(state.theme)
watch(() => state.theme, applyTheme)

export function setTheme(theme: Theme) {
  state.theme = theme
}

// ------------------------------------------------------------------ audio graph (lazy: needs a user gesture)
let ctx: AudioContext | null = null
let radio: AmRadio | null = null
let musicGain: GainNode
let analyser: AnalyserNode
let audioEl: HTMLAudioElement
let keepAlive: HTMLAudioElement
let house: Generative | null = null
let streamToken = 0
let localQueue: File[] = []
let localIndex = 0

/**
 * A second, inaudible <audio> element that is NOT routed through Web Audio. Android browsers give
 * background priority (a media notification, a foreground service) to pages that are visibly playing
 * media, and an element whose sound goes into an AudioContext doesn't count. Its content is a
 * 1-LSB dither, effectively silence but not digital zero, so it isn't treated as muted.
 */
function createKeepAlive() {
  const rate = 8000
  const samples = rate * 2
  const buf = new ArrayBuffer(44 + samples * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples * 2, true)
  str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) v.setInt16(44 + i * 2, Math.random() < 0.5 ? -1 : 1, true)
  const el = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })))
  el.loop = true
  // Not treated as a stop request: browsers also pause media in the background, which must not end the
  // broadcast. The notification's pause/stop buttons arrive through the Media Session handlers instead.
  el.addEventListener('pause', () => log('keep-alive paused'))
  return el
}

/**
 * Page lifecycle and network events, logged for the diagnostics. With the screen locked, Android may
 * freeze the page or cut the network; seeing which of these happened (and when) tells us what to fix.
 */
function watchLifecycle() {
  document.addEventListener('freeze', () => log('页面被系统冻结 (freeze)'))
  document.addEventListener('resume', () => log('页面解冻 (resume)'))
  window.addEventListener('pagehide', () => log('pagehide'))
  window.addEventListener('pageshow', () => log('pageshow'))
  window.addEventListener('online', () => log('网络恢复 (online)'))
  window.addEventListener('offline', () => log('网络断开 (offline)'))
  const conn = (navigator as unknown as { connection?: EventTarget & { effectiveType?: string; type?: string } }).connection
  conn?.addEventListener('change', () => log(`网络类型变化 ${conn.type ?? ''} ${conn.effectiveType ?? ''}`))
}

function ensureAudio() {
  if (ctx) return ctx
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  ctx = new AC({ latencyHint: 'playback' })
  // Safari 16.4+: treat this page as media playback, so audio keeps going in the background / with the screen
  // locked and ignores the silent switch (the default session type "auto" lets the system stop Web Audio)
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession
  if (session) session.type = 'playback'
  radio = createAmRadio(ctx, { mode: state.mode, mainsHz: state.mains, fx: { ...state.fx } })
  radio.setEco(document.hidden)

  musicGain = ctx.createGain()
  musicGain.connect(radio.input)

  analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  radio.output.connect(analyser)
  analyser.connect(ctx.destination)

  audioEl = new Audio()
  audioEl.crossOrigin = 'anonymous' // required: Web Audio refuses to process opaque cross-origin media
  audioEl.preload = 'none'
  ctx.createMediaElementSource(audioEl).connect(musicGain)
  for (const type of ['playing', 'pause', 'waiting', 'stalled', 'error', 'ended', 'emptied']) {
    audioEl.addEventListener(type, () => {
      const code = type === 'error' ? ` code=${audioEl.error?.code}` : ''
      log(`stream ${type}${code} t=${audioEl.currentTime.toFixed(1)} ready=${audioEl.readyState}`)
    })
  }
  ctx.addEventListener('statechange', () => log(`audio context ${ctx?.state}`))
  keepAlive = createKeepAlive()
  audioEl.addEventListener('playing', () => {
    if (state.source === 'stream' || state.source === 'local') state.tuning = false
  })
  audioEl.addEventListener('ended', () => {
    if (state.source === 'local') nextLocal()
  })
  document.addEventListener('visibilitychange', onVisibility)
  watchLifecycle()
  return ctx
}

function log(message: string) {
  const t = new Date().toTimeString().slice(0, 8)
  state.log.push(`${t} ${document.hidden ? '[后台] ' : ''}${message}`)
  if (state.log.length > 120) state.log.splice(0, state.log.length - 120)
}

const preset = () => PRESETS.find((p) => p.id === state.preset) ?? PRESETS[0]

// ------------------------------------------------------------------ sources
function stopSources() {
  streamToken++
  clearTimeout(stallTimer)
  if (audioEl) {
    audioEl.onerror = audioEl.onended = audioEl.onwaiting = audioEl.onplaying = null
    audioEl.pause()
    audioEl.removeAttribute('src')
    audioEl.load()
  }
  house?.stop()
  house = null
}

function startHouse(why = '') {
  if (!ctx) return
  house = startGenerative(ctx, musicGain, state.preset)
  state.source = 'house'
  state.station = ''
  state.tuning = false
  state.note = `${why ? why + '，' : ''}先由内置乐队演奏 · 点「换台」重试`
}

// Stations already tried (played or failed) per preset, so "next station" keeps moving through the pool.
const seen = new Map<PresetId, Set<string>>()
let stallTimer = 0

function playUrl(url: string, token: number): Promise<boolean> {
  return new Promise((resolve) => {
    let timer = 0
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      audioEl.removeEventListener('playing', onPlaying)
      audioEl.removeEventListener('error', onError)
      resolve(ok)
    }
    const onPlaying = () => finish(true)
    const onError = () => finish(false)
    audioEl.addEventListener('playing', onPlaying)
    audioEl.addEventListener('error', onError)
    timer = window.setTimeout(() => finish(false), STREAM_TIMEOUT_MS)
    if (token !== streamToken) return finish(false)
    audioEl.src = url
    audioEl.play().catch(() => finish(false))
  })
}

/** First URL of a station that answers a CORS request; mirrors are probed in parallel. */
async function reachableUrl(st: Station): Promise<string | undefined> {
  const urls = st.urls.slice(0, 3)
  const ok = await Promise.all(urls.map((u) => probeStream(u, PROBE_TIMEOUT_MS)))
  return urls[ok.indexOf(true)]
}

/**
 * Find a real station for the current preset: the last one that worked, then the curated
 * SomaFM channels, then the Radio Browser directory. Candidates are probed a few at a time
 * (so dead or CORS-less servers cost one timeout, not one each) and played in order.
 * Falls back to the built-in band when nothing works.
 */
async function startStream(fresh = true) {
  const token = ++streamToken
  const preset = state.preset
  const tried = seen.get(preset) ?? new Set<string>()
  seen.set(preset, tried)
  if (fresh) tried.clear() // re-tuning starts from the best known station again
  state.source = 'stream'
  state.station = ''
  state.note = '正在搜索电台…'

  const last = lastStation(preset)
  const candidates = (...lists: Station[][]) => {
    const unique = new Map([...lists.flat()].map((s) => [s.urls[0], s]))
    return [...unique.values()].filter((s) => !tried.has(s.urls[0]))
  }

  const directoryPromise = loadDirectory(preset, state.lang) // fetched while the curated stations are tried

  let attempts = 0
  let reachable = 0
  let probed = 0
  const run = async (list: Station[]) => {
    for (let i = 0; i < list.length; i += PROBE_BATCH) {
      if (token !== streamToken || attempts >= MAX_ATTEMPTS) return false
      const batch = list.slice(i, i + PROBE_BATCH)
      state.note = `正在连接 ${batch[0].name}…`
      const urls = await Promise.all(batch.map(reachableUrl))
      probed += batch.length
      reachable += urls.filter(Boolean).length
      for (let k = 0; k < batch.length; k++) {
        if (token !== streamToken) return false
        const st = batch[k]
        tried.add(st.urls[0])
        if (!urls[k] || attempts >= MAX_ATTEMPTS) continue
        attempts++
        state.note = `正在连接 ${st.name}…`
        if (await playUrl(urls[k]!, token)) {
          if (token !== streamToken) return false
          state.station = st.name
          state.note = st.country ? `${st.name} · ${st.country}` : st.name
          rememberStation(preset, st)
          log(`已连接 ${st.name}`)
          updateMediaSession(st.name)
          watchStream(token)
          return true
        }
      }
    }
    return false
  }

  if (await run(candidates(last ? [last] : [], curatedFor(preset, state.lang)))) return
  if (token !== streamToken) return
  const directory = await directoryPromise
  if (token !== streamToken) return
  if (await run(candidates(directory))) return
  if (token !== streamToken) return
  // pool exhausted or unreachable: start over next time, and keep the music going meanwhile
  tried.clear()
  startHouse(
    directory.length
      ? `检测了 ${probed} 个电台，${reachable} 个可连接，但都没能开始播放`
      : `电台目录连不上，精选电台也没有响应（检测了 ${probed} 个）`,
  )
}

/** Once a stream is playing: a dropped or stalled connection moves on to another station. */
function watchStream(token: number) {
  const next = () => {
    if (token === streamToken && state.playing && state.source === 'stream') {
      // a dropped connection: reconnect (the remembered, i.e. current, station is tried first)
      state.tuning = true
      void startStream(true)
    }
  }
  audioEl.onerror = next
  audioEl.onended = next
  audioEl.onwaiting = () => {
    clearTimeout(stallTimer)
    // In the background the browser is merely re-buffering (phones throttle the network); replacing the
    // element's source there can't be undone on iOS, so leave it to the heartbeat and the foreground check.
    if (document.hidden) return
    stallTimer = window.setTimeout(next, STALL_TIMEOUT_MS)
  }
  audioEl.onplaying = () => clearTimeout(stallTimer)
}

// ------------------------------------------------------------------ heartbeat
// While on air, every few seconds make sure the media element really is playing. The OS can pause it
// (audio focus, lock screen) without telling the page; resuming the same element is allowed where
// starting a new stream is not. A stream that is truly dead is reconnected, later when in the background.
const HEARTBEAT_MS = 4000
const DEAD_FOREGROUND_TICKS = 4
const DEAD_BACKGROUND_TICKS = 15
let heartbeat = 0
let deadTicks = 0
let lastTime = -1

let lastBeat = 0

function beat() {
  const now = Date.now()
  // a long gap between beats means timers were throttled or the page was frozen (screen locked)
  if (lastBeat && now - lastBeat > HEARTBEAT_MS * 2.5) log(`心跳间隔 ${Math.round((now - lastBeat) / 1000)} 秒：页面被限速或冻结`)
  lastBeat = now
  if (!state.playing || !ctx || state.tuning) return
  if (ctx.state !== 'running') void ctx.resume()
  if (keepAlive.paused) keepAlive.play().catch(() => undefined)
  if (state.source !== 'stream' && state.source !== 'local') return
  const stuck = audioEl.paused || audioEl.ended || (audioEl.currentTime === lastTime && audioEl.readyState < 4)
  lastTime = audioEl.currentTime
  if (!stuck) {
    deadTicks = 0
    return
  }
  deadTicks++
  if (audioEl.paused && audioEl.src) {
    log('心跳：播放被暂停，尝试恢复')
    audioEl.play().catch((e) => log(`心跳：恢复失败 ${e?.name}`))
  }
  const limit = document.hidden ? DEAD_BACKGROUND_TICKS : DEAD_FOREGROUND_TICKS
  if (deadTicks >= limit && state.source === 'stream') {
    log(`心跳：流已停止 ${deadTicks} 次检测，重新连接`)
    deadTicks = 0
    state.tuning = true
    void startStream(true)
  }
}

/**
 * Phones suspend or drop media while the page is in the background (and Safari won't start a new
 * stream from there). Coming back, make sure the audio is really playing, otherwise reconnect.
 */
function onVisibility() {
  log(document.hidden ? '页面进入后台' : '页面回到前台')
  if (!ctx) return
  radio?.setEco(document.hidden)
  if (!state.playing) return
  if (document.hidden) {
    return
  }
  void ctx.resume()
  if (state.source === 'local') {
    if (audioEl.paused) audioEl.play().catch(() => undefined)
    return
  }
  if (state.source === 'static') return
  const live = state.source === 'stream' && !audioEl.paused && !audioEl.ended && audioEl.readyState >= 3
  if (state.tuning || live) return
  // stalled stream, or the built-in band standing in while we were away: go back to a real station
  state.tuning = true
  stopSources()
  void startStream(true)
}

function nextLocal() {
  if (!localQueue.length) return
  localIndex = (localIndex + 1) % localQueue.length
  playLocalAt(localIndex)
}

function playLocalAt(i: number) {
  const f = localQueue[i]
  audioEl.src = URL.createObjectURL(f)
  audioEl.play().catch(() => undefined)
  state.source = 'local'
  state.note = `本地音乐 · ${f.name}`
}

// ------------------------------------------------------------------ clocks (elapsed, sleep, signal bars)
let onAirSince = 0
let sleepEnd = 0
let clock = 0

function tickClock() {
  const now = Date.now()
  state.elapsed = Math.floor((now - onAirSince) / 1000)
  if (sleepEnd) {
    state.sleepLeft = Math.max(0, Math.ceil((sleepEnd - now) / 1000))
    if (state.sleepLeft === 0) sleepNow()
  }
  const fade = radio && state.mode !== 'clean' ? radio.fadeNow() : 0
  state.signal = Math.max(1, 5 - Math.floor(fade * 4.5))
}

function sleepNow() {
  sleepEnd = 0
  state.sleepMin = 0
  state.sleepLeft = 0
  if (ctx) {
    musicGain.gain.cancelScheduledValues(ctx.currentTime)
    musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.8)
  }
  window.setTimeout(pause, 3000)
}

// ------------------------------------------------------------------ public API
/** Safari/iOS only lets an element start playing inside a user gesture; a silent clip played here
 *  "unlocks" it, so the real stream can be started later, after the async station search. */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

export async function play() {
  if (state.playing) return
  const c = ensureAudio()
  const resumed = c.resume()
  audioEl.src = SILENT_WAV
  audioEl.play().catch(() => undefined)
  keepAlive.play().catch((e) => log(`keep-alive play failed: ${e?.name}`))
  await resumed
  if (state.playing) return
  state.playing = true
  state.tuning = true
  onAirSince = Date.now()
  state.elapsed = 0
  clearInterval(clock)
  clock = window.setInterval(tickClock, 250)
  clearInterval(heartbeat)
  deadTicks = 0
  lastBeat = 0
  heartbeat = window.setInterval(beat, HEARTBEAT_MS)
  musicGain.gain.cancelScheduledValues(c.currentTime)
  musicGain.gain.setValueAtTime(1, c.currentTime)
  startSource()
  updateMediaSession()
}

/** The preset whose station is on the air (or being connected). */
let tunedPreset: PresetId | '' = ''

function goStatic() {
  tunedPreset = ''
  state.source = 'static'
  state.station = ''
  state.tuning = false
  state.note = '电台之间只有电波噪声 · 转动旋钮对准一个频道'
}

function startSource() {
  radio?.tuneSweep()
  if (localQueue.length) return playLocalAt(localIndex)
  if (!state.locked) return goStatic()
  tunedPreset = state.preset
  void startStream()
}

export function pause() {
  if (!state.playing) return
  keepAlive?.pause()
  state.playing = false
  state.tuning = false
  state.source = ''
  clearInterval(clock)
  clearInterval(heartbeat)
  sleepEnd = 0
  state.sleepMin = 0
  state.sleepLeft = 0
  stopSources()
  state.note = ''
  if (ctx) {
    // keep the context alive a moment so the stop doesn't click, then park it
    const c = ctx
    window.setTimeout(() => {
      if (!state.playing) c.suspend()
    }, 300)
  }
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
}

export function togglePlay() {
  return state.playing ? pause() : play()
}

export async function tune(id: PresetId) {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0]
  const sameChannel = state.locked && id === state.preset
  state.preset = id
  state.freq = p.freq // the dial jumps to the channel
  state.locked = true
  clearTimeout(settleTimer)
  localQueue = []
  localIndex = 0
  if (!state.playing) return play()
  // tapping the channel that is on the air again stops it
  if (sameChannel && state.source !== 'local' && state.source !== 'static') return pause()
  state.tuning = true
  stopSources()
  startSource()
  updateMediaSession()
}

/** Dial on to another station of the current preset. */
export function nextStation() {
  if (!state.playing || state.source === 'local' || state.source === 'static') return
  state.tuning = true
  stopSources()
  radio?.tuneSweep()
  void startStream(false)
}

let settleTimer = 0

/**
 * The tuning knob. The dial snaps to a channel when it gets close (a detent) and the station is
 * connected once the knob has rested for a moment; anywhere else there is only radio noise.
 */
export function setFrequency(raw: number) {
  let f = Math.round(Math.min(FREQ_MAX, Math.max(FREQ_MIN, raw)) * 10) / 10
  const hit = PRESETS.find((p) => Math.abs(p.freq - f) <= LOCK_WINDOW)
  if (hit) f = hit.freq
  if (f === state.freq && !!hit === state.locked) return
  if (hit && !state.locked) navigator.vibrate?.(8) // a small click when a channel catches
  state.freq = f
  state.locked = !!hit
  if (hit) state.preset = hit.id
  clearTimeout(settleTimer)
  settleTimer = window.setTimeout(settle, 350)
}

function settle() {
  if (!state.playing) return
  if (state.locked) {
    if (tunedPreset === state.preset && (state.source === 'stream' || state.source === 'house')) return
    localQueue = []
    localIndex = 0
    state.tuning = true
    stopSources()
    startSource()
    updateMediaSession()
  } else if (state.source !== 'local' && state.source !== 'static') {
    stopSources()
    radio?.tuneSweep()
    goStatic()
  }
}

export function setMode(mode: RadioMode) {
  if (mode === state.mode) return
  state.mode = mode
  radio?.setMode(mode)
  if (state.playing && mode !== 'clean') radio?.tuneSweep()
}

export function setLang(lang: Lang) {
  state.lang = lang
}

export function setSleep(minutes: number) {
  state.sleepMin = SLEEP_STEPS.includes(minutes) ? minutes : 0
  sleepEnd = minutes > 0 ? Date.now() + minutes * 60_000 : 0
  state.sleepLeft = minutes * 60
}

export function setMains(hz: 50 | 60) {
  state.mains = hz
  radio?.setMains(hz)
}

export function setFx(key: keyof RadioFx, value: number) {
  state.fx[key] = value
  radio?.setFx({ [key]: value })
}

export function resetFx() {
  state.fx = { ...DEFAULT_FX }
  radio?.setFx({ ...DEFAULT_FX })
}

export async function playLocalFiles(files: File[]) {
  const list = files.filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(f.name))
  if (!list.length) return
  localQueue = list
  localIndex = 0
  if (state.playing) {
    stopSources()
    state.tuning = true
    startSource()
  } else {
    await play()
  }
}

export function getOutputLevel() {
  if (!analyser) return 0
  const buf = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(buf)
  let s = 0
  for (const v of buf) s += v * v
  return Math.sqrt(s / buf.length)
}

export const debug = {
  state,
  get ctx() {
    return ctx
  },
  get audio() {
    return audioEl
  },
  level: getOutputLevel,
}

function updateMediaSession(station = '') {
  if (!('mediaSession' in navigator)) return
  const p = preset()
  navigator.mediaSession.metadata = new MediaMetadata({
    title: station || `${p.name} · FM ${p.freq.toFixed(1)}`,
    artist: station ? `${p.name} · AI 电台` : 'AI 电台',
    album: 'AI Radio',
    artwork: ['192x192', '512x512'].map((size) => ({ src: new URL(`${import.meta.env.BASE_URL}icon-${size}.png`, location.href).href, sizes: size, type: 'image/png' })),
  })
  navigator.mediaSession.playbackState = 'playing'
  navigator.mediaSession.setActionHandler('play', () => void play())
  navigator.mediaSession.setActionHandler('pause', () => pause())
  navigator.mediaSession.setActionHandler('stop', () => pause())
}

/** Environment + recent events as plain text, for the diagnostics section of the settings sheet. */
export function diagnostics(): string {
  const nav = navigator as unknown as { audioSession?: { type: string } }
  const lines = [
    `UA: ${navigator.userAgent}`,
    `安全上下文: ${window.isSecureContext}  可见性: ${document.visibilityState}`,
    `AudioContext: ${ctx ? `${ctx.state} ${ctx.sampleRate}Hz` : '未创建'}  audioSession: ${nav.audioSession ? nav.audioSession.type : '不支持'}`,
    `mediaSession: ${'mediaSession' in navigator}`,
    `网络: ${navigator.onLine ? 'online' : 'offline'} ${(navigator as unknown as { connection?: { type?: string; effectiveType?: string } }).connection?.type ?? ''} ${(navigator as unknown as { connection?: { effectiveType?: string } }).connection?.effectiveType ?? ''}`,
    `来源: ${state.source || '-'}  电台: ${state.station || '-'}  播放中: ${state.playing}`,
    '--- 最近事件 ---',
    ...state.log,
  ]
  return lines.join('\n')
}
