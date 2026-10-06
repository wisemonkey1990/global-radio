<script setup lang="ts">
import { computed, ref } from 'vue'
import { SLEEP_STEPS } from '../data'

const props = defineProps<{ modelValue: number }>()
const emit = defineEmits<{ 'update:modelValue': [minutes: number] }>()

const track = ref<HTMLElement>()
const index = computed(() => Math.max(0, SLEEP_STEPS.indexOf(props.modelValue)))
// thumb centre as a fraction of the track, kept inside the ends
const pct = (i: number) => (i / (SLEEP_STEPS.length - 1)) * 100

function fromPointer(e: PointerEvent) {
  if (!track.value) return
  const r = track.value.getBoundingClientRect()
  const pad = 24
  const f = (e.clientX - r.left - pad) / (r.width - pad * 2)
  const i = Math.round(Math.max(0, Math.min(1, f)) * (SLEEP_STEPS.length - 1))
  if (SLEEP_STEPS[i] !== props.modelValue) emit('update:modelValue', SLEEP_STEPS[i])
}

function down(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  fromPointer(e)
}

function move(e: PointerEvent) {
  if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) fromPointer(e)
}

function step(dir: -1 | 1) {
  emit('update:modelValue', SLEEP_STEPS[Math.max(0, Math.min(SLEEP_STEPS.length - 1, index.value + dir))])
}
</script>

<template>
  <div
    ref="track"
    class="fader"
    tabindex="0"
    role="slider"
    aria-label="定时暂停"
    :aria-valuemin="0"
    :aria-valuemax="90"
    :aria-valuenow="modelValue"
    :aria-valuetext="modelValue ? `${modelValue} 分钟后暂停` : '关闭'"
    @pointerdown="down"
    @pointermove="move"
    @keydown.left.prevent="step(-1)"
    @keydown.right.prevent="step(1)"
  >
    <div class="fader-scale">
      <span v-for="(m, i) in SLEEP_STEPS" :key="m" :style="{ left: `calc(24px + (100% - 48px) * ${pct(i) / 100})` }" :class="{ on: i === index }">
        {{ m === 0 ? 'OFF' : m }}<i />
      </span>
    </div>
    <div class="fader-slot" />
    <div class="fader-thumb" :style="{ left: `calc(24px + (100% - 48px) * ${pct(index) / 100})` }"><i /><i /><i /></div>
  </div>
</template>
