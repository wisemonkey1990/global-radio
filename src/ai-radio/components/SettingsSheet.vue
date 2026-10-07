<script setup lang="ts">
import { ref } from 'vue'
import { THEMES } from '../data'
import { diagnostics, playLocalFiles, setMains, setTheme, state } from '../engine'

const base = import.meta.env.BASE_URL
const emit = defineEmits<{ close: [] }>()
const files = ref<HTMLInputElement>()

async function pick(e: Event) {
  const input = e.target as HTMLInputElement
  const list = Array.from(input.files ?? [])
  input.value = ''
  if (list.length) {
    emit('close')
    await playLocalFiles(list)
  }
}

const diag = ref('')
const copied = ref(false)
function openDiag(e: Event) {
  if ((e.target as HTMLDetailsElement).open) diag.value = diagnostics()
}
async function copyDiag() {
  diag.value = diagnostics()
  try {
    await navigator.clipboard.writeText(diag.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* clipboard unavailable: the text is selectable below */
  }
}

</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <section class="sheet" role="dialog" aria-label="设置">
      <header>
        <h2>设置</h2>
        <button class="sheet-close" aria-label="关闭" @click="emit('close')">✕</button>
      </header>

      <div class="field">
        <label>主题 <small>外观风格</small></label>
        <div class="seg">
          <button v-for="t in THEMES" :key="t.id" :class="{ on: state.theme === t.id }" @click="setTheme(t.id)">{{ t.label }}</button>
        </div>
      </div>

      <div class="field">
        <label>市电频率 <small>交流哼声的基频</small></label>
        <div class="seg">
          <button :class="{ on: state.mains === 50 }" @click="setMains(50)">50 Hz</button>
          <button :class="{ on: state.mains === 60 }" @click="setMains(60)">60 Hz</button>
        </div>
      </div>

      <div class="field">
        <label>自带唱片 <small>用自己的音乐试听收音机的音色</small></label>
        <button class="wide" @click="files?.click()">选择本地音频…</button>
        <input ref="files" type="file" accept="audio/*" multiple hidden @change="pick" />
      </div>

      <details class="diag" @toggle="openDiag">
        <summary>诊断信息 <small>播放有问题时，把这里的内容发给开发者</small></summary>
        <pre>{{ diag }}</pre>
        <button class="wide" @click="copyDiag">{{ copied ? '已复制' : '刷新并复制' }}</button>
      </details>

      <p class="credit">
        网络信号源：精选的 <a href="https://somafm.com" target="_blank" rel="noopener">SomaFM</a> 频道，以及 <a href="https://www.radio-browser.info" target="_blank" rel="noopener">Radio Browser</a> 社区目录里按风格挑出的真实电台（只选支持音效处理的 https 流）。点右上角「换台」可在同一频道里换下一个；全都收不到时切换到内置乐队。<br />
        <a :href="`${base}classic/`">打开经典版全球电台（搜索 / 收藏 / 历史）</a>
      </p>
    </section>
  </div>
</template>
