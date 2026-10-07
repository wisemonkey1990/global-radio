import type { Host, Lang } from './data'

export interface TtsConfig {
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 */
  url: string
  key: string
  model: string
  /** voice name per host id; empty = host default */
  voices: Record<string, string>
}

export const emptyTts = (): TtsConfig => ({ url: '', key: '', model: 'gpt-4o-mini-tts', voices: {} })
export const ttsReady = (c: TtsConfig) => !!(c.url.trim() && c.key.trim())

/**
 * Fetches speech from an OpenAI-compatible `/audio/speech` endpoint and decodes it, so that
 * the DJ can be played *through* the radio chain like the music. Throws on any failure.
 */
export async function fetchSpeech(ctx: BaseAudioContext, cfg: TtsConfig, text: string, host: Host, signal?: AbortSignal) {
  const res = await fetch(cfg.url.replace(/\/+$/, '') + '/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key.trim()}` },
    body: JSON.stringify({
      model: cfg.model || 'gpt-4o-mini-tts',
      input: text,
      voice: cfg.voices[host.id]?.trim() || host.ttsVoice,
      response_format: 'mp3',
    }),
    signal,
  })
  if (!res.ok) throw new Error(`TTS ${res.status}`)
  return ctx.decodeAudioData(await res.arrayBuffer())
}

const MALE = /(^|\W)(male|man)\b|yunxi|yunjian|yunyang|yunfeng|kangkang|daniel|alex|fred|david|mark|guy|ryan|aaron|thomas|google uk english male/i
const FEMALE = /female|woman|xiaoxiao|xiaoyi|xiaohan|tingting|meijia|sinji|samantha|karen|zira|aria|jenny|susan|moira|huihui|yaoyao|google us english|google 普通话/i

const synth = () => ('speechSynthesis' in window ? window.speechSynthesis : null)

/** Voices load asynchronously in some browsers: give them a moment before concluding there are none. */
async function loadedVoices(): Promise<SpeechSynthesisVoice[]> {
  const s = synth()
  if (!s) return []
  if (s.getVoices().length) return s.getVoices()
  await new Promise<void>((resolve) => {
    const t = window.setTimeout(resolve, 1500)
    s.addEventListener(
      'voiceschanged',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })
  return s.getVoices()
}

/**
 * Voices to try, best first. Voices that run on the device come before network ones (Chrome's
 * "Google …" voices need Google's servers, which fail silently where those are unreachable),
 * and a gender match breaks ties. The final `null` lets the browser choose by language alone.
 */
export function voiceCandidates(voices: SpeechSynthesisVoice[], lang: Lang, host: Host): Array<SpeechSynthesisVoice | null> {
  const prefix = lang === 'zh' ? 'zh' : 'en'
  const wanted = host.gender === 'f' ? FEMALE : MALE
  const other = host.gender === 'f' ? MALE : FEMALE
  const rank = (v: SpeechSynthesisVoice) => (v.localService ? 0 : 2) + (wanted.test(v.name) ? 0 : other.test(v.name) ? 1.5 : 0.5)
  const ofLang = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(prefix)).sort((a, b) => rank(a) - rank(b))
  return [...ofLang.slice(0, 3), null]
}

let speechToken = 0

function speakOnce(text: string, lang: Lang, host: Host, voice: SpeechSynthesisVoice | null): Promise<boolean> {
  return new Promise((resolve) => {
    const s = synth()!
    const u = new SpeechSynthesisUtterance(text)
    u.lang = voice?.lang || (lang === 'zh' ? 'zh-CN' : 'en-US')
    u.voice = voice
    u.pitch = host.pitch
    u.rate = host.rate
    // a voice that never starts (offline network voice, no engine) must not hang the broadcast
    const watchdog = window.setTimeout(() => {
      s.cancel()
      resolve(false)
    }, 5000)
    u.onstart = () => clearTimeout(watchdog)
    u.onend = () => {
      clearTimeout(watchdog)
      resolve(true)
    }
    u.onerror = (e) => {
      clearTimeout(watchdog)
      // "canceled"/"interrupted" are our own cancel(): not a failure of the voice
      resolve(e.error === 'canceled' || e.error === 'interrupted')
    }
    s.resume() // a tab that was hidden can leave the synthesiser paused
    s.speak(u)
  })
}

/**
 * Browser speech synthesis, falling back through the available voices. Resolves to false when
 * nothing could speak. NOTE: the Web Speech API plays straight to the speakers; browsers give no
 * way to route it into Web Audio, so this voice can't pass through the radio filter.
 */
export async function speakWithBrowser(text: string, lang: Lang, host: Host): Promise<boolean> {
  if (!synth()) return false
  const token = ++speechToken
  for (const voice of voiceCandidates(await loadedVoices(), lang, host)) {
    if (token !== speechToken) return true // cancelled meanwhile
    try {
      if (await speakOnce(text, lang, host, voice)) return true
    } catch {
      /* this voice can't be used; try the next one */
    }
  }
  return false
}

/** Safari/iOS only allows the first utterance inside a user gesture: a silent one "unlocks" speech. */
export function unlockSpeech() {
  const s = synth()
  if (!s) return
  const u = new SpeechSynthesisUtterance(' ')
  u.volume = 0
  s.speak(u)
}

export function cancelBrowserSpeech() {
  speechToken++
  synth()?.cancel()
}
