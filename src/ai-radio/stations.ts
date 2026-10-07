// Real internet-radio sources.
//
// 1. A small curated list (SomaFM) that is known to serve CORS headers and plays first.
// 2. The community Radio Browser directory (radio-browser.info), queried by genre tags that
//    match each preset, then filtered down to what the radio chain can actually use.
//
// Web Audio can only process media that the server sends CORS headers for, so every directory
// candidate is probed with a CORS `fetch` (headers only, body is aborted) before it is played.

import type { Lang, PresetId } from './data'

export interface Station {
  name: string
  /** candidate URLs for the same station (mirrors), tried in order */
  urls: string[]
  country?: string
  bitrate?: number
  votes?: number
  /** where it came from; curated stations are trusted and not probed */
  origin: 'curated' | 'directory'
}

const SERVERS = ['de1', 'de2', 'all', 'fr1', 'nl1', 'at1', 'us1'].map((h) => `https://${h}.api.radio-browser.info`)
const CACHE_TTL_MS = 12 * 3600 * 1000
const CACHE_KEY = 'ai-radio:dir:v1'

const soma = (id: string, name: string): Station => ({
  name: `SomaFM · ${name}`,
  urls: ['ice1', 'ice2', 'ice4', 'ice6'].map((m) => `https://${m}.somafm.com/${id}-128-mp3`),
  country: 'US',
  origin: 'curated',
})

export const CURATED: Record<PresetId, Station[]> = {
  mood: [soma('groovesalad', 'Groove Salad'), soma('groovesalad2', 'Groove Salad 2')],
  discover: [soma('indiepop', 'Indie Pop Rocks!'), soma('folkfwd', 'Folk Forward')],
  focus: [soma('dronezone', 'Drone Zone'), soma('deepspaceone', 'Deep Space One')],
  road: [soma('seventies', 'Left Coast 70s'), soma('u80s', 'Underground 80s')],
  night: [soma('lush', 'Lush'), soma('sonicuniverse', 'Sonic Universe')],
  oldies: [soma('7soul', 'Seven Inch Soul'), soma('illstreet', 'Illinois Street Lounge')],
  sport: [soma('poptron', 'PopTron'), soma('beatblender', 'Beat Blender')],
}

type Query = { tag?: string; language?: string; countrycode?: string }

/** What to ask the directory for, per preset. */
const GLOBAL_QUERIES: Record<PresetId, Query[]> = {
  mood: [{ tag: 'chillout' }, { tag: 'lounge' }, { tag: 'easy listening' }],
  discover: [{ tag: 'indie' }, { tag: 'alternative' }, { tag: 'new music' }],
  focus: [{ tag: 'ambient' }, { tag: 'piano' }, { tag: 'classical' }],
  road: [{ tag: 'classic rock' }, { tag: 'rock' }, { tag: 'pop' }],
  night: [{ tag: 'jazz' }, { tag: 'smooth jazz' }, { tag: 'downtempo' }],
  oldies: [{ tag: 'oldies' }, { tag: '60s' }, { tag: '70s' }],
  sport: [{ tag: 'dance' }, { tag: 'electronic' }, { tag: 'edm' }],
}

/** Chinese-language music stations, mixed in when the DJ language is Chinese. */
const CHINESE_QUERIES: Partial<Record<PresetId, Query[]>> = {
  mood: [{ language: 'chinese', tag: 'pop' }],
  discover: [{ language: 'chinese', tag: 'pop' }],
  road: [{ countrycode: 'CN', tag: 'music' }],
  oldies: [{ language: 'chinese', tag: 'oldies' }],
}

interface DirectoryRow {
  name: string
  url_resolved: string
  codec: string
  bitrate: number
  countrycode: string
  votes: number
  tags: string
  hls: number
  ssl_error: number
  lastcheckok: number
}

let goodServer = 0

async function directoryFetch(q: Query): Promise<DirectoryRow[]> {
  const params = new URLSearchParams({
    hidebroken: 'true',
    is_https: 'true',
    order: 'votes',
    reverse: 'true',
    limit: '60',
    ...(q.tag ? { tag: q.tag } : {}),
    ...(q.language ? { language: q.language } : {}),
    ...(q.countrycode ? { countrycode: q.countrycode } : {}),
  })
  for (let i = 0; i < SERVERS.length; i++) {
    const server = SERVERS[(goodServer + i) % SERVERS.length]
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 6000)
    try {
      const res = await fetch(`${server}/json/stations/search?${params}`, { signal: ac.signal })
      if (!res.ok) continue
      goodServer = (goodServer + i) % SERVERS.length
      return (await res.json()) as DirectoryRow[]
    } catch {
      /* try the next mirror */
    } finally {
      clearTimeout(timer)
    }
  }
  return []
}

/** Talk, news and religious programming are not what a music preset is for. */
const NOT_MUSIC = /quran|koran|qur'an|bible|gospel|sermon|church|christian|catholic|islam|prayer|religio|talk|news|podcast|sport|weather|radio ?maria|القرآن|إذاعة|新闻|交通|经济|曲艺|相声|戏曲|评书/i

/** Keep stations a plain <audio> element can stream over https: no HLS, no broken certificates. */
function usable(r: DirectoryRow): boolean {
  if (NOT_MUSIC.test(`${r.name} ${r.tags}`)) return false
  if (!r.url_resolved?.startsWith('https://') || r.hls || r.ssl_error || r.lastcheckok !== 1) return false
  if (/\.m3u8?(\?|$)/i.test(r.url_resolved)) return false
  const codec = (r.codec || '').toUpperCase()
  if (codec === 'MP3' || codec === 'AAC' || codec === 'AAC+') return true
  return codec === 'UNKNOWN' && /\.(mp3|aac)(\?|$)/i.test(r.url_resolved)
}

function toStation(r: DirectoryRow): Station {
  return {
    name: r.name.replace(/^[\s#\-–—>]+/, '').trim() || r.name,
    urls: [r.url_resolved],
    country: r.countrycode || undefined,
    bitrate: r.bitrate || undefined,
    votes: r.votes,
    origin: 'directory',
  }
}

/** Popular first, but don't burn mobile data on 320 kbps streams when a lighter one will do. */
const score = (s: Station) => (s.votes ?? 0) * (s.bitrate && s.bitrate > 192 ? 0.3 : 1)

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (b[i]) out.push(b[i])
    if (a[i]) out.push(a[i])
  }
  return out
}

function readCache(key: string): Station[] | null {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
    const hit = all[key]
    return hit && Date.now() - hit.t < CACHE_TTL_MS ? hit.list : null
  } catch {
    return null
  }
}

function writeCache(key: string, list: Station[]) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
    all[key] = { t: Date.now(), list }
    localStorage.setItem(CACHE_KEY, JSON.stringify(all))
  } catch {
    /* storage unavailable or full */
  }
}

const inflight = new Map<string, Promise<Station[]>>()

/** Directory candidates for a preset (cached for 12 h). Resolves to [] when the directory is unreachable. */
export function loadDirectory(preset: PresetId, lang: Lang): Promise<Station[]> {
  const key = `${preset}:${lang}`
  const cached = readCache(key)
  if (cached) return Promise.resolve(cached)
  let p = inflight.get(key)
  if (!p) {
    p = (async () => {
      const build = async (queries: Query[]) => {
        const seen = new Map<string, Station>()
        for (const rows of await Promise.all(queries.map(directoryFetch))) {
          for (const r of rows) if (usable(r) && !seen.has(r.url_resolved)) seen.set(r.url_resolved, toStation(r))
        }
        return [...seen.values()].sort((a, b) => score(b) - score(a)).slice(0, 60)
      }
      const global = await build(GLOBAL_QUERIES[preset])
      const chinese = lang === 'zh' && CHINESE_QUERIES[preset] ? await build(CHINESE_QUERIES[preset]!) : []
      const list = interleave(global, chinese.slice(0, 20))
      if (list.length) writeCache(key, list)
      return list
    })().finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

/**
 * Can Web Audio use this stream? Sends a CORS request and only reads the headers, so a server
 * that doesn't allow cross-origin access (or is dead) is rejected within `ms`.
 */
export async function probeStream(url: string, ms = 5000): Promise<boolean> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    const res = await fetch(url, { mode: 'cors', signal: ac.signal, cache: 'no-store' })
    const type = res.headers.get('content-type') || ''
    return res.ok && (/audio|ogg|mpeg|aac|octet-stream/i.test(type) || type === '')
  } catch {
    return false
  } finally {
    clearTimeout(timer)
    ac.abort() // we only wanted the headers
  }
}

const LAST_KEY = 'ai-radio:last:v1'

export function rememberStation(preset: PresetId, station: Station) {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_KEY) || '{}')
    all[preset] = station
    localStorage.setItem(LAST_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

export function lastStation(preset: PresetId): Station | undefined {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) || '{}')[preset]
  } catch {
    return undefined
  }
}
