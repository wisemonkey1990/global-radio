import type { RadioMode } from './audio/amRadio'

export type PresetId = 'mood' | 'discover' | 'focus' | 'road' | 'night' | 'oldies' | 'sport' | 'jazz'
export type Lang = 'zh' | 'en'
export type Theme = 'dark' | 'retro'

export interface Preset {
  id: PresetId
  /** FM frequency shown on the dial (MHz). On the AM voices the dial reads freq × 10 kHz. */
  freq: number
  name: string
  tagline: string
}

/** Eight channels, evenly spread over the dial (2.5 MHz apart, give or take a rounding). */
export const PRESETS: Preset[] = [
  { id: 'mood', freq: 89.0, name: '随心', tagline: '看时间、看状态，熟悉的和新鲜的搭着放' },
  { id: 'discover', freq: 91.6, name: '新发现', tagline: '没听过的歌，也许正合你意' },
  { id: 'focus', freq: 94.1, name: '专注', tagline: '少一点起伏，多一点心流' },
  { id: 'road', freq: 96.7, name: '在路上', tagline: '窗外的风景，配上合适的节拍' },
  { id: 'night', freq: 99.3, name: '深夜', tagline: '夜深了，音量放轻，慢慢听' },
  { id: 'oldies', freq: 101.9, name: '老歌', tagline: '经得起时间的那些旋律' },
  { id: 'sport', freq: 104.4, name: '运动', tagline: '心率拉起来，节拍跟上' },
  { id: 'jazz', freq: 107.0, name: '爵士', tagline: '萨克斯、钢琴和一点即兴，慢悠悠的' },
]



/** The tuning dial covers the FM band; on the AM voices the same position reads freq × 10 kHz. */
export const FREQ_MIN = 87.5
export const FREQ_MAX = 108
/** A channel locks in when the dial is within this many MHz of it (a magnetic detent). */
export const LOCK_WINDOW = 0.25

export const SLEEP_STEPS = [0, 15, 30, 45, 60, 75, 90]

export interface ModeInfo {
  id: RadioMode
  label: string
  /** knob pointer angle, degrees from 12 o'clock */
  angle: number
  desc: string
}

export const MODES: ModeInfo[] = [
  { id: 'clean', label: '原声', angle: -60, desc: '录音棚直出，原本的声音。' },
  { id: 'mw', label: '中波', angle: 0, desc: '早期中波机：单声道、窄频带，嘶嘶底噪、静电噼啪，信号时强时弱。' },
  { id: 'tube', label: '电子管', angle: 60, desc: '电子管收音机：更暖更脏的失真，信号慢慢起伏，隐约的交流哼声。' },
]

export const THEMES: Array<{ id: Theme; label: string; /** browser UI colour */ color: string }> = [
  { id: 'dark', label: '深色', color: '#1b1b1b' },
  { id: 'retro', label: '复古黄', color: '#ecd78f' },
]

export const LANGS: Array<{ id: Lang; label: string }> = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
]

export function dialText(freq: number, mode: RadioMode) {
  return mode === 'clean'
    ? { band: 'FM', value: freq.toFixed(1), unit: 'MHz' }
    : { band: 'AM', value: String(Math.round(freq * 10)), unit: 'kHz' }
}
