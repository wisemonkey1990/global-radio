<script setup lang="ts">
import { computed, ref } from 'vue'
import { FREQ_MAX, FREQ_MIN, LOCK_WINDOW, PRESETS, dialText } from '../data'
import type { RadioMode } from '../audio/amRadio'

const props = defineProps<{ modelValue: number; locked: boolean; playing: boolean; mode: RadioMode }>()
const emit = defineEmits<{ 'update:modelValue': [freq: number] }>()

// the dial sweeps 280 degrees, from -140 (low end) to +140 (high end), measured clockwise from 12 o'clock
const SWEEP = 140
const angleOf = (f: number) => ((f - FREQ_MIN) / (FREQ_MAX - FREQ_MIN)) * SWEEP * 2 - SWEEP
const freqOf = (a: number) => FREQ_MIN + ((a + SWEEP) / (SWEEP * 2)) * (FREQ_MAX - FREQ_MIN)

const W = 260
const H = 252
const CX = W / 2
const CY = 144
const R = 106
const at = (deg: number, r: number) => ({ x: CX + r * Math.sin((deg * Math.PI) / 180), y: CY - r * Math.cos((deg * Math.PI) / 180) })

const ticks = computed(() => {
  const out: Array<{ x1: number; y1: number; x2: number; y2: number; major: boolean }> = []
  for (let f = 88; f <= 108; f += 0.5) {
    const major = Number.isInteger(f)
    const a = angleOf(f)
    const p1 = at(a, R)
    const p2 = at(a, R - (major ? 11 : 6))
    out.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, major })
  }
  return out
})
const labels = computed(() => [90, 95, 100, 105].map((f) => ({ f, ...at(angleOf(f), R - 24) })))
const marks = computed(() => PRESETS.map((p) => ({ id: p.id, freq: p.freq, ...at(angleOf(p.freq), R + 9) })))

const angle = computed(() => angleOf(props.modelValue))
const readout = computed(() => {
  const d = dialText(props.modelValue, props.mode)
  return `${d.band} ${d.value} ${d.unit}`
})

const knob = ref<HTMLElement>()
let last = 0
let raw = 0

function pointerAngle(e: PointerEvent) {
  const r = knob.value!.getBoundingClientRect()
  return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI
}

function down(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  last = pointerAngle(e)
  raw = angleOf(props.modelValue)
}

function move(e: PointerEvent) {
  if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
  const a = pointerAngle(e)
  let d = a - last
  if (d > 180) d -= 360
  if (d < -180) d += 360
  last = a
  // the unsnapped angle is tracked separately, so the knob can leave a channel's detent again
  raw = Math.max(-SWEEP, Math.min(SWEEP, raw + d))
  emit('update:modelValue', freqOf(raw))
}

/** Step the dial from the keyboard or wheel; leaving a channel jumps clear of its detent. */
function nudge(delta: number) {
  let f = props.modelValue + delta
  const on = PRESETS.find((p) => Math.abs(p.freq - props.modelValue) < 0.05)
  if (on && Math.abs(f - on.freq) <= LOCK_WINDOW) f = on.freq + Math.sign(delta) * (LOCK_WINDOW + 0.1)
  emit('update:modelValue', f)
}

function wheel(e: WheelEvent) {
  nudge(e.deltaY < 0 ? 0.1 : -0.1)
}
</script>

<template>
  <div class="tuner" :style="{ '--tw': `${W}px`, '--th': `${H}px` }">
    <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" aria-hidden="true">
      <line v-for="(t, i) in ticks" :key="i" :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" class="tk-tick" :class="{ major: t.major }" />
      <text v-for="l in labels" :key="l.f" :x="l.x" :y="l.y" class="tk-label" text-anchor="middle" dominant-baseline="central">{{ l.f }}</text>
      <circle v-for="m in marks" :key="m.id" :cx="m.x" :cy="m.y" r="2.6" class="tk-mark" :class="{ on: locked && Math.abs(m.freq - modelValue) < 0.05 }" />
    </svg>

    <div class="tk-lamp" :class="{ on: locked && playing }"><i class="led" />TUNED</div>

    <div
      ref="knob"
      class="tk-knob"
      tabindex="0"
      role="slider"
      aria-label="调频旋钮"
      :aria-valuemin="FREQ_MIN"
      :aria-valuemax="FREQ_MAX"
      :aria-valuenow="modelValue"
      :aria-valuetext="readout"
      @pointerdown="down"
      @pointermove="move"
      @wheel.prevent="wheel"
      @keydown.left.prevent="nudge(-0.1)"
      @keydown.right.prevent="nudge(0.1)"
      @keydown.down.prevent="nudge(-0.1)"
      @keydown.up.prevent="nudge(0.1)"
      @keydown.page-down.prevent="nudge(-1)"
      @keydown.page-up.prevent="nudge(1)"
    >
      <div class="tk-rim" :style="{ transform: `rotate(${angle}deg)` }">
        <div class="tk-face"><i class="tk-notch" /><i class="tk-dimple" /></div>
      </div>
    </div>
  </div>
</template>
