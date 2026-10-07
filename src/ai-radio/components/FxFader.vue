<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ modelValue: number; label: string; hint: string; /** show "关" at the bottom (noise-like sources) */ offAtZero?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const track = ref<HTMLElement>()
const clamp = (v: number) => Math.max(0, Math.min(1, v))

const readout = computed(() => {
  if (props.offAtZero && props.modelValue === 0) return '关'
  const d = Math.round((props.modelValue - 0.5) * 200)
  return d > 0 ? `+${d}` : String(d)
})

function fromPointer(e: PointerEvent) {
  const r = track.value!.getBoundingClientRect()
  const pad = 11 // half the thumb: the thumb centre travels between the two ends of the slot
  emit('update:modelValue', Math.round(clamp(1 - (e.clientY - r.top - pad) / (r.height - pad * 2)) * 100) / 100)
}

function down(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  fromPointer(e)
}

function move(e: PointerEvent) {
  if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) fromPointer(e)
}

function step(delta: number) {
  emit('update:modelValue', Math.round(clamp(props.modelValue + delta) * 100) / 100)
}
</script>

<template>
  <div class="fxf">
    <output class="fxf-val" :class="{ moved: modelValue !== 0.5 }">{{ readout }}</output>
    <div
      ref="track"
      class="fxf-track"
      tabindex="0"
      role="slider"
      aria-orientation="vertical"
      :aria-label="`${label}：${hint}`"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(modelValue * 100)"
      :title="`${hint}（双击恢复默认）`"
      @pointerdown="down"
      @pointermove="move"
      @dblclick="emit('update:modelValue', 0.5)"
      @keydown.up.prevent="step(0.05)"
      @keydown.right.prevent="step(0.05)"
      @keydown.down.prevent="step(-0.05)"
      @keydown.left.prevent="step(-0.05)"
    >
      <i class="fxf-tick" v-for="n in 5" :key="n" :class="{ mid: n === 3 }" :style="{ top: `calc(11px + (100% - 22px) * ${(n - 1) / 4})` }" />
      <span class="fxf-slot" />
      <span class="fxf-thumb" :style="{ top: `calc(11px + (100% - 22px) * ${1 - modelValue})` }"><i /><i /></span>
    </div>
    <span class="fxf-label">{{ label }}</span>
  </div>
</template>
