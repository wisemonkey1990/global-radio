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
const FEMALE = /female|woman|xiaoxiao|xiaoyi|xiaohan|tingting|meijia|sinji|samantha|karen|zira|aria|jenny|susan|moira|google us english|google 普通话/i

export function pickVoice(lang: Lang, host: Host): SpeechSynthesisVoice | undefined {
  const prefix = lang === 'zh' ? 'zh' : 'en'
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(prefix))
  const byGender = voices.filter((v) => (host.gender === 'f' ? FEMALE : MALE).test(v.name) && !(host.gender === 'm' && FEMALE.test(v.name)))
  return byGender[0] ?? voices.find((v) => v.default) ?? voices[0]
}

/**
 * Browser speech synthesis. NOTE: the Web Speech API plays straight to the speakers; browsers
 * give no way to route it into Web Audio, so this voice can't pass through the radio filter.
 */
export function speakWithBrowser(text: string, lang: Lang, host: Host): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang === 'zh' ? 'zh-CN' : 'en-US'
    u.voice = pickVoice(lang, host) ?? null
    u.pitch = host.pitch
    u.rate = host.rate
    u.onend = () => resolve()
    u.onerror = () => resolve()
    speechSynthesis.speak(u)
  })
}

export function cancelBrowserSpeech() {
  if ('speechSynthesis' in window) speechSynthesis.cancel()
}
