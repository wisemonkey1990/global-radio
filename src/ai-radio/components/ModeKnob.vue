<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RadioMode } from '../audio/amRadio'
import { MODES } from '../data'

const props = defineProps<{ modelValue: RadioMode }>()
const emit = defineEmits<{ 'update:modelValue': [mode: RadioMode] }>()

const knob = ref<HTMLElement>()
const angle = computed(() => MODES.find((m) => m.id === props.modelValue)?.angle ?? 0)

function nearest(deg: number) {
  return MODES.reduce((a, b) => (Math.abs(b.angle - deg) < Math.abs(a.angle - deg) ? b : a))
}

function onPointer(e: PointerEvent) {
  if (!knob.value) return
  const r = knob.value.getBoundingClientRect()
  const dx = e.clientX - (r.left + r.width / 2)
  const dy = e.clientY - (r.top + r.height / 2)
  if (Math.hypot(dx, dy) < 6) return
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI // 0 = up, clockwise positive
  emit('update:modelValue', nearest(Math.max(-90, Math.min(90, deg))).id)
}

function down(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  onPointer(e)
}

function move(e: PointerEvent) {
  if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) onPointer(e)
}

function step(dir: -1 | 1) {
  const i = MODES.findIndex((m) => m.id === props.modelValue)
  const next = MODES[Math.max(0, Math.min(MODES.length - 1, i + dir))]
  emit('update:modelValue', next.id)
}
</script>

<template>
  <div class="knob-block" role="radiogroup" aria-label="音质">
    <button
      v-for="m in MODES"
      :key="m.id"
      class="knob-label"
      :class="['pos-' + m.id, { active: m.id === modelValue }]"
      role="radio"
      :aria-checked="m.id === modelValue"
      @click="emit('update:modelValue', m.id)"
    >
      <i v-if="m.id === modelValue" class="led" />{{ m.label }}
    </button>
    <div
      ref="knob"
      class="knob"
      tabindex="0"
      role="slider"
      aria-label="音质旋钮"
      :aria-valuetext="MODES.find((m) => m.id === modelValue)?.label"
      @pointerdown="down"
      @pointermove="move"
      @keydown.left.prevent="step(-1)"
      @keydown.right.prevent="step(1)"
      @keydown.down.prevent="step(-1)"
      @keydown.up.prevent="step(1)"
    >
      <span class="knob-cap" :style="{ transform: `rotate(${angle}deg)` }"><i /></span>
    </div>
  </div>
</template>
