import type { RadioMode } from './audio/amRadio'

export type PresetId = 'mood' | 'discover' | 'focus' | 'road' | 'night' | 'oldies' | 'sport'
export type HostId = 'randy' | 'kevin' | 'iris'
export type Lang = 'zh' | 'en'
export type Theme = 'dark' | 'retro'

export interface Preset {
  id: PresetId
  /** FM frequency shown on the dial (MHz). On the AM voices the dial reads freq × 10 kHz. */
  freq: number
  name: string
  tagline: string
}

export const PRESETS: Preset[] = [
  { id: 'mood', freq: 89.6, name: '随心', tagline: '看时间、看状态，熟悉的和新鲜的搭着放' },
  { id: 'discover', freq: 92.3, name: '新发现', tagline: '没听过的歌，也许正合你意' },
  { id: 'focus', freq: 95.1, name: '专注', tagline: '少一点起伏，多一点心流' },
  { id: 'road', freq: 98.4, name: '在路上', tagline: '窗外的风景，配上合适的节拍' },
  { id: 'night', freq: 101.7, name: '深夜', tagline: '夜深了，音量放轻，慢慢听' },
  { id: 'oldies', freq: 104.5, name: '老歌', tagline: '经得起时间的那些旋律' },
  { id: 'sport', freq: 107.2, name: '运动', tagline: '心率拉起来，节拍跟上' },
]

export interface Host {
  id: HostId
  name: string
  desc: string
  /** Web Speech fallback tuning */
  gender: 'm' | 'f'
  pitch: number
  rate: number
  /** default voice name for OpenAI-compatible /audio/speech endpoints */
  ttsVoice: string
}

export const HOSTS: Host[] = [
  { id: 'randy', name: 'Randy', desc: '男声 · 低沉松弛，懂歌也会聊', gender: 'm', pitch: 0.75, rate: 0.92, ttsVoice: 'onyx' },
  { id: 'kevin', name: 'Kevin', desc: '男声 · 明朗有劲，节奏感强', gender: 'm', pitch: 1, rate: 1.05, ttsVoice: 'echo' },
  { id: 'iris', name: 'Iris', desc: '女声 · 温柔沉静，陪你到深夜', gender: 'f', pitch: 1.05, rate: 0.95, ttsVoice: 'nova' },
]

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

export function dialText(preset: Preset, mode: RadioMode) {
  return mode === 'clean'
    ? { band: 'FM', value: preset.freq.toFixed(1), unit: 'MHz' }
    : { band: 'AM', value: String(Math.round(preset.freq * 10)), unit: 'kHz' }
}
