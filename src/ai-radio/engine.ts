// Radio engine: owns the AudioContext, the radio chain, the stream / house-band / local
// sources, DJ breaks, sleep timer, and the reactive state the UI renders.

import { reactive, watch } from 'vue'
import { createAmRadio, type AmRadio, type RadioMode } from './audio/amRadio'
import { startGenerative, type Generative } from './audio/generative'
import { HOSTS, PRESETS, SLEEP_STEPS, type HostId, type Lang, type PresetId } from './data'
import { cueLine, djLine } from './dj'
import { curatedFor, lastStation, loadDirectory, probeStream, rememberStation, type Station } from './stations'
import { cancelBrowserSpeech, emptyTts, fetchSpeech, speakWithBrowser, ttsReady, unlockSpeech, type TtsConfig } from './voice'

const STORE_KEY = 'ai-radio:v1'
const STREAM_TIMEOUT_MS = 9000
const PROBE_TIMEOUT_MS = 4000
const PROBE_BATCH = 4
const STALL_TIMEOUT_MS = 12000
const MAX_ATTEMPTS = 10
const DUCK_LEVEL = 0.25

interface Saved {
  preset: PresetId
  host: HostId
  mode: RadioMode
  lang: Lang
  mains: 50 | 60
  ambience: number
  tts: TtsConfig
}

function load(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
  } catch {
    return {}
  }
}

const saved = load()

export const state = reactive({
  preset: (PRESETS.some((p) => p.id === saved.preset) ? saved.preset : 'mood') as PresetId,
  host: (HOSTS.some((h) => h.id === saved.host) ? saved.host : 'kevin') as HostId,
  mode: (['clean', 'mw', 'tube'].includes(saved.mode as string) ? saved.mode : 'mw') as RadioMode,
  lang: (saved.lang === 'en' ? 'en' : 'zh') as Lang,
  mains: (saved.mains === 60 ? 60 : 50) as 50 | 60,
  /** 0..1.5, scales hiss / static / hum / interference */
  ambience: typeof saved.ambience === 'number' ? saved.ambience : 1,
  tts: { ...emptyTts(), ...saved.tts } as TtsConfig,

  playing: false,
  /** true from tuning until the first sound of the new station arrives */
  tuning: false,
  source: '' as '' | 'stream' | 'house' | 'local',
  /** name of the station currently on the air (stream source) */
  station: '',
  note: '',
  /** 1..5 bars */
  signal: 5,
  elapsed: 0,
  sleepMin: 0,
  sleepLeft: 0,
  djSpeaking: false,
  /** short-lived message that takes over the status line */
  alert: '',
  cueHost: '' as HostId | '',
})

watch(
  () => [state.preset, state.host, state.mode, state.lang, state.mains, state.ambience, state.tts],
  () => {
    const out: Saved = {
      preset: state.preset,
      host: state.host,
      mode: state.mode,
      lang: state.lang,
      mains: state.mains,
      ambience: state.ambience,
      tts: state.tts,
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(out))
    } catch {
      /* storage unavailable */
    }
  },
  { deep: true },
)

// ------------------------------------------------------------------ audio graph (lazy: needs a user gesture)
let ctx: AudioContext | null = null
let radio: AmRadio | null = null
let musicGain: GainNode
let voiceGain: GainNode
let analyser: AnalyserNode
let audioEl: HTMLAudioElement
let house: Generative | null = null
let voiceSrc: AudioBufferSourceNode | null = null
let streamToken = 0
let localQueue: File[] = []
let localIndex = 0

function ensureAudio() {
  if (ctx) return ctx
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  ctx = new AC({ latencyHint: 'playback' })
  // Safari 16.4+: treat this page as media playback, so audio keeps going in the background / with the screen
  // locked and ignores the silent switch (the default session type "auto" lets the system stop Web Audio)
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession
  if (session) session.type = 'playback'
  radio = createAmRadio(ctx, { mode: state.mode, mainsHz: state.mains })
  radio.setAmbience(state.ambience)
  radio.setEco(document.hidden)

  musicGain = ctx.createGain()
  voiceGain = ctx.createGain()
  musicGain.connect(radio.input)
  voiceGain.connect(radio.input)

  analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  radio.output.connect(analyser)
  analyser.connect(ctx.destination)

  audioEl = new Audio()
  audioEl.crossOrigin = 'anonymous' // required: Web Audio refuses to process opaque cross-origin media
  audioEl.preload = 'none'
  ctx.createMediaElementSource(audioEl).connect(musicGain)
  audioEl.addEventListener('playing', () => {
    if (state.source === 'stream' || state.source === 'local') state.tuning = false
  })
  audioEl.addEventListener('ended', () => {
    if (state.source === 'local') nextLocal()
  })
  document.addEventListener('visibilitychange', onVisibility)
  return ctx
}

let alertTimer = 0
function flash(message: string) {
  state.alert = message
  clearTimeout(alertTimer)
  alertTimer = window.setTimeout(() => (state.alert = ''), 9000)
}

const preset = () => PRESETS.find((p) => p.id === state.preset) ?? PRESETS[0]
const host = (id: HostId | '' = state.host) => HOSTS.find((h) => h.id === id) ?? HOSTS[0]

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

function beat() {
  if (!state.playing || !ctx || state.tuning) return
  if (ctx.state !== 'running') void ctx.resume()
  if (state.source !== 'stream' && state.source !== 'local') return
  const stuck = audioEl.paused || audioEl.ended || (audioEl.currentTime === lastTime && audioEl.readyState < 4)
  lastTime = audioEl.currentTime
  if (!stuck) {
    deadTicks = 0
    return
  }
  deadTicks++
  if (audioEl.paused && audioEl.src) audioEl.play().catch(() => undefined)
  const limit = document.hidden ? DEAD_BACKGROUND_TICKS : DEAD_FOREGROUND_TICKS
  if (deadTicks >= limit && state.source === 'stream') {
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
  if (!ctx) return
  radio?.setEco(document.hidden)
  if (!state.playing) return
  if (document.hidden) {
    if (state.djSpeaking) {
      stopVoice()
      state.djSpeaking = false
      state.cueHost = ''
      duck(false)
    }
    return
  }
  void ctx.resume()
  if (state.source === 'local') {
    if (audioEl.paused) audioEl.play().catch(() => undefined)
    return
  }
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

// ------------------------------------------------------------------ DJ
let djTimer = 0

function scheduleDj(seconds: number) {
  clearTimeout(djTimer)
  djTimer = window.setTimeout(async () => {
    if (!state.playing) return
    if (state.tuning) return scheduleDj(3) // let the station come in first
    await speak(djLine(state.lang, preset(), host()), host())
    scheduleDj(240 + Math.random() * 120)
  }, seconds * 1000)
}

function duck(on: boolean) {
  if (!ctx) return
  musicGain.gain.setTargetAtTime(on ? DUCK_LEVEL : 1, ctx.currentTime, on ? 0.2 : 0.8)
}

function playBuffer(buf: AudioBuffer) {
  return new Promise<void>((resolve) => {
    const src = ctx!.createBufferSource()
    src.buffer = buf
    src.connect(voiceGain)
    src.onended = () => {
      if (voiceSrc === src) voiceSrc = null
      resolve()
    }
    voiceSrc = src
    src.start()
  })
}

async function speak(text: string, h = host()) {
  // Browsers stall speech synthesis in background tabs and never report its end, which would leave the
  // music ducked for good. Skip DJ talk while hidden; the next break will come round later.
  if (document.hidden) return
  state.djSpeaking = true
  duck(true)
  let guard = 0
  const say = async () => {
    if (ctx && ttsReady(state.tts)) {
      try {
        // routed through the radio chain: the DJ sounds like it comes out of the same set
        await playBuffer(await fetchSpeech(ctx, state.tts, text, h))
        return
      } catch {
        state.note = '外部语音接口出错，改用浏览器语音（这种语音不会经过收音机滤波）'
      }
    }
    if (!(await speakWithBrowser(text, state.lang, h))) {
      flash('DJ 语音不可用：这个浏览器/设备没有能用的语音合成。可在设置里接入语音接口')
    }
  }
  try {
    // never wait longer than the line can plausibly take
    await Promise.race([say(), new Promise<void>((resolve) => (guard = window.setTimeout(resolve, 6000 + text.length * 400)))])
  } finally {
    clearTimeout(guard)
    stopVoice()
    state.djSpeaking = false
    duck(false)
  }
}

function stopVoice() {
  cancelBrowserSpeech()
  try {
    voiceSrc?.stop()
  } catch {
    /* already stopped */
  }
  voiceSrc = null
}

function silenceDj() {
  clearTimeout(djTimer)
  stopVoice()
  state.djSpeaking = false
  state.cueHost = ''
  if (ctx) musicGain.gain.setTargetAtTime(1, ctx.currentTime, 0.05)
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
  unlockSpeech()
  const resumed = c.resume()
  audioEl.src = SILENT_WAV
  audioEl.play().catch(() => undefined)
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
  heartbeat = window.setInterval(beat, HEARTBEAT_MS)
  musicGain.gain.cancelScheduledValues(c.currentTime)
  musicGain.gain.setValueAtTime(1, c.currentTime)
  startSource()
  scheduleDj(6)
  updateMediaSession()
}

function startSource() {
  radio?.tuneSweep()
  if (localQueue.length) playLocalAt(localIndex)
  else void startStream()
}

export function pause() {
  if (!state.playing) return
  state.playing = false
  state.tuning = false
  state.source = ''
  clearInterval(clock)
  clearInterval(heartbeat)
  sleepEnd = 0
  state.sleepMin = 0
  state.sleepLeft = 0
  silenceDj()
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
  const changed = id !== state.preset
  state.preset = id
  localQueue = []
  localIndex = 0
  if (!state.playing) return play()
  if (!changed && state.source !== 'local') return pause() // tapping the playing channel again stops it
  state.tuning = true
  clearTimeout(djTimer)
  cancelBrowserSpeech()
  stopSources()
  startSource()
  scheduleDj(5)
  updateMediaSession()
}

/** Dial on to another station of the current preset. */
export function nextStation() {
  if (!state.playing || state.source === 'local') return
  state.tuning = true
  clearTimeout(djTimer)
  cancelBrowserSpeech()
  stopSources()
  radio?.tuneSweep()
  void startStream(false)
  scheduleDj(6)
}

export function setHost(id: HostId) {
  state.host = id
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

export function setAmbience(amount: number) {
  state.ambience = amount
  radio?.setAmbience(amount)
}

/** CUE: audition a host's voice, even while the radio is off. */
export async function cue(id: HostId) {
  if (state.cueHost) return
  const c = ensureAudio()
  await c.resume()
  state.cueHost = id
  try {
    await speak(cueLine(state.lang, host(id)), host(id))
  } finally {
    state.cueHost = ''
    if (!state.playing) window.setTimeout(() => !state.playing && c.suspend(), 300)
  }
}

export async function playLocalFiles(files: File[]) {
  const list = files.filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(f.name))
  if (!list.length) return
  localQueue = list
  localIndex = 0
  if (state.playing) {
    clearTimeout(djTimer)
    stopSources()
    state.tuning = true
    startSource()
    scheduleDj(30)
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
  })
  navigator.mediaSession.playbackState = 'playing'
  navigator.mediaSession.setActionHandler('play', () => void play())
  navigator.mediaSession.setActionHandler('pause', () => pause())
}
