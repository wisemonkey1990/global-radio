import { createApp } from 'vue'
import App from './App.vue'
import { debug } from './engine'
import './style.css'

createApp(App).mount('#app')

// `?debug` exposes the engine for poking at it from the console
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __radio: typeof debug }).__radio = debug
