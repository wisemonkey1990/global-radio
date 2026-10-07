<script setup lang="ts">
import { computed } from 'vue'
import type { RadioFx } from '../audio/amRadio'
import { resetFx, setFx, state } from '../engine'
import FxFader from './FxFader.vue'

const tone: Array<{ key: keyof RadioFx; label: string; hint: string }> = [
  { key: 'bandwidth', label: '带宽', hint: '高频能到多高：往下更闷，往上更亮' },
  { key: 'lowcut', label: '低切', hint: '低频砍到多高：往上声音更薄' },
  { key: 'drive', label: '失真', hint: '偏暖的谐波失真和过载' },
  { key: 'compression', label: '压缩', hint: '自动增益压缩：往上动态更小' },
  { key: 'box', label: '箱声', hint: '小喇叭和机箱的共鸣' },
]
const air: Array<{ key: keyof RadioFx; label: string; hint: string }> = [
  { key: 'hiss', label: '底噪', hint: '沙沙的嘶嘶声' },
  { key: 'crackle', label: '静电', hint: '偶发的噼啪声' },
  { key: 'hum', label: '哼声', hint: '极轻的交流嗡嗡声' },
  { key: 'interference', label: '串台', hint: '邻频杂音和短促啸叫' },
  { key: 'fading', label: '衰落', hint: '信号时强时弱的起伏' },
]

const changed = computed(() => Object.values(state.fx).some((v) => v !== 0.5))
</script>

<template>
  <div class="fx" :class="{ off: state.mode === 'clean' }">
    <div class="fx-head">
      <p>
        <template v-if="state.mode === 'clean'">原声模式下不做处理，切到中波或电子管后生效。</template>
        <template v-else>双击推子恢复默认，中间一格是这台收音机原本的样子。</template>
      </p>
      <button class="fx-reset" :disabled="!changed" @click="resetFx()">重置</button>
    </div>
    <div class="fx-group"><span class="cap">TONE<small>音色</small></span></div>
    <div class="fx-row">
      <FxFader v-for="f in tone" :key="f.key" :model-value="state.fx[f.key]" :label="f.label" :hint="f.hint" @update:model-value="setFx(f.key, $event)" />
    </div>
    <div class="fx-group"><span class="cap">AIR<small>电波</small></span></div>
    <div class="fx-row">
      <FxFader v-for="f in air" :key="f.key" :model-value="state.fx[f.key]" :label="f.label" :hint="f.hint" off-at-zero @update:model-value="setFx(f.key, $event)" />
    </div>
  </div>
</template>
