<script setup lang="ts">
import { ref } from 'vue'
import { HOSTS } from '../data'
import { playLocalFiles, setAmbience, setMains, state } from '../engine'
import { ttsReady } from '../voice'

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

const pctText = (v: number) => (v === 0 ? '关' : `${Math.round(v * 100)}%`)
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <section class="sheet" role="dialog" aria-label="设置">
      <header>
        <h2>设置</h2>
        <button class="sheet-close" aria-label="关闭" @click="emit('close')">✕</button>
      </header>

      <div class="field">
        <label for="amb">电波干扰 <small>底噪 · 静电 · 哼声 · 串台</small></label>
        <div class="range-row">
          <input id="amb" type="range" min="0" max="1.5" step="0.05" :value="state.ambience" @input="setAmbience(+($event.target as HTMLInputElement).value)" />
          <output>{{ pctText(state.ambience) }}</output>
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

      <div class="field">
        <label>
          DJ 语音接口 <small>{{ ttsReady(state.tts) ? '已启用，DJ 的声音会和音乐一起经过收音机' : '可选' }}</small>
        </label>
        <p class="hint">
          浏览器自带的语音合成无法接入 Web Audio，所以 DJ 的声音不会被收音机处理。填入兼容 OpenAI 的
          <code>/audio/speech</code> 接口后，DJ 的声音就会和音乐一样经过中波 / 电子管滤波。密钥只保存在本机浏览器。
        </p>
        <input v-model.trim="state.tts.url" class="text" type="url" placeholder="接口地址，如 https://api.openai.com/v1" autocomplete="off" />
        <input v-model.trim="state.tts.key" class="text" type="password" placeholder="API Key" autocomplete="off" />
        <input v-model.trim="state.tts.model" class="text" type="text" placeholder="模型，如 gpt-4o-mini-tts" autocomplete="off" />
        <div class="voices">
          <input v-for="h in HOSTS" :key="h.id" v-model.trim="state.tts.voices[h.id]" class="text" type="text" :placeholder="`${h.name}：${h.ttsVoice}`" autocomplete="off" />
        </div>
      </div>

      <p class="credit">
        网络信号源：<a href="https://somafm.com" target="_blank" rel="noopener">SomaFM</a>（听众支持的独立电台）。收不到时自动切换到内置乐队。
      </p>
    </section>
  </div>
</template>
