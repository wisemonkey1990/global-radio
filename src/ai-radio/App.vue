<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ModeKnob from './components/ModeKnob.vue'
import SettingsSheet from './components/SettingsSheet.vue'
import SleepFader from './components/SleepFader.vue'
import { HOSTS, LANGS, MODES, PRESETS, dialText } from './data'
import { cue, nextStation, setHost, setLang, setMode, setSleep, state, togglePlay, tune } from './engine'

const showSettings = ref(false)
const showLang = ref(false)

const current = computed(() => PRESETS.find((p) => p.id === state.preset) ?? PRESETS[0])
const currentHost = computed(() => HOSTS.find((h) => h.id === state.host) ?? HOSTS[0])
const currentMode = computed(() => MODES.find((m) => m.id === state.mode) ?? MODES[1])
const dial = computed(() => dialText(current.value, state.mode))
const langLabel = computed(() => LANGS.find((l) => l.id === state.lang)?.label ?? '')

const mmss = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
const clock = computed(() => (state.sleepMin ? mmss(state.sleepLeft) : mmss(state.elapsed)))

const status = computed(() => {
  if (!state.playing) return '点下面的「开始收听」，或直接点一个频道开机'
  if (state.tuning) return '调谐中…'
  if (state.djSpeaking) return `${currentHost.value.name} 正在播报`
  return state.note
})

function closeLang(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.lang')) showLang.value = false
}

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement).tagName
  if (e.code === 'Space' && tag !== 'BUTTON' && tag !== 'INPUT') {
    e.preventDefault()
    void togglePlay()
  }
}

onMounted(() => {
  document.addEventListener('click', closeLang)
  document.addEventListener('keydown', onKey)
  // voices load asynchronously in some browsers
  if ('speechSynthesis' in window) speechSynthesis.getVoices()
})
onBeforeUnmount(() => {
  document.removeEventListener('click', closeLang)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <main class="radio" :class="[`mode-${state.mode}`, { on: state.playing }]">
    <header class="top">
      <span class="brand">GLOBAL<span> AI RADIO</span></span>
      <button class="onair" :class="{ live: state.playing, sleep: state.playing && state.sleepMin > 0 }" :aria-pressed="state.playing" @click="togglePlay()">
        <i class="led" />
        <span>{{ state.playing ? 'ON AIR' : 'OFF AIR' }}</span>
        <em />
        <time>{{ clock }}</time>
      </button>
      <button class="gear" aria-label="设置" @click="showSettings = true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      </button>
    </header>

    <section class="dial" aria-live="polite">
      <div class="freq" :class="{ long: dial.value.length > 3 }">
        <span class="band">{{ dial.band }}</span>
        <span class="num">{{ dial.value }}</span>
        <span class="unit">{{ dial.unit }}</span>
      </div>
      <div class="meter">
        <span class="bars" :aria-label="`信号 ${state.signal}/5`">
          <i v-for="n in 5" :key="n" :class="{ lit: n <= state.signal }" :style="{ height: `${6 + n * 4}px` }" />
        </span>
        <span class="badge">{{ state.mode === 'clean' ? 'STEREO' : 'MONO' }}</span>
      </div>
    </section>

    <p class="now">
      <b>{{ current.name }}</b><span>{{ current.tagline }}</span>
    </p>
    <p class="status" :class="{ busy: state.tuning }">{{ status }}</p>

    <button class="power" :class="{ on: state.playing }" :aria-label="state.playing ? '停止播放' : '开始收听'" @click="togglePlay()">
      <svg v-if="state.playing" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
      <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
      <span>{{ state.playing ? '停止播放' : '开始收听' }}</span>
    </button>

    <section class="panel">
      <div class="panel-head">
        <span class="cap">PRESETS<small>快捷调频</small></span>
        <span class="cap">
          <button v-if="state.playing && state.source !== 'local'" class="next" aria-label="换一个电台" @click="nextStation()">↻ 换台</button>
          {{ dial.band }} {{ dial.value }}
        </span>
      </div>
      <div class="presets">
        <button v-for="p in PRESETS" :key="p.id" class="key preset" :class="{ active: p.id === state.preset }" @click="tune(p.id)">
          <small><i v-if="p.id === state.preset" class="led" />{{ dialText(p, state.mode).value }}</small>
          <span>{{ p.name }}</span>
        </button>
      </div>

      <h2 class="sec">主持<small>{{ currentHost.desc }}</small></h2>
      <div class="hosts">
        <div v-for="h in HOSTS" :key="h.id" class="host">
          <button class="key" :class="{ active: h.id === state.host }" @click="setHost(h.id)">
            <i v-if="h.id === state.host" class="led" />{{ h.name }}
          </button>
          <button class="cue" :class="{ lit: h.id === state.host, speaking: state.cueHost === h.id }" :aria-label="`试听 ${h.name} 的声音`" @click="cue(h.id)">
            <span>CUE</span>
            <span class="vu"><i /><i /><i /><i /><i /></span>
          </button>
        </div>
      </div>

      <h2 class="sec">音质<small>给整台电台的声音上色</small></h2>
      <div class="quality">
        <p class="mode-desc">{{ currentMode.desc }}</p>
        <ModeKnob :model-value="state.mode" @update:model-value="setMode" />
      </div>

      <h2 class="sec">定时暂停<small>向右拨，到点自动暂停</small></h2>
      <SleepFader :model-value="state.sleepMin" @update:model-value="setSleep" />

      <div class="lang" :class="{ open: showLang }">
        <button class="lang-row" :aria-expanded="showLang" @click.stop="showLang = !showLang">
          <b>语言</b><small>所有台通用</small>
          <span class="lang-val">{{ langLabel }}<svg viewBox="0 0 12 8" width="12" height="8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6.5 6 1.5l5 5" /></svg></span>
        </button>
        <ul v-if="showLang" class="lang-list" role="listbox">
          <li v-for="l in LANGS" :key="l.id" role="option" :aria-selected="l.id === state.lang" :class="{ on: l.id === state.lang }" @click="setLang(l.id); showLang = false">
            {{ l.label }}
          </li>
        </ul>
      </div>
    </section>

    <SettingsSheet v-if="showSettings" @close="showSettings = false" />
  </main>
</template>
