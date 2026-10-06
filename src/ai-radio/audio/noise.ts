// Pre-rendered "radio air" textures: hiss, static crackle, heterodyne whistles,
// adjacent-station murmur and slow fading curves.
//
// They are rendered once into short looping AudioBuffers (with different loop
// lengths, so the combined pattern never audibly repeats) and then played by
// AudioBufferSourceNodes. That keeps the whole radio simulation on the audio
// thread: nothing has to be scheduled from timers, so it keeps working
// (and keeps fading / crackling) when the tab is in the background.

export type Rand = () => number

export function mulberry32(seed: number): Rand {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const gauss = (rand: Rand) => {
  const u = Math.max(rand(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

const expo = (rand: Rand, mean: number) => -Math.log(Math.max(rand(), 1e-9)) * mean

/** Sample rates of the pre-rendered buffers. Everything in them lives below
 *  ~4 kHz (it is band limited by the IF filter anyway), so low rates are fine. */
export const TEXTURE_RATE = 16000
export const CONTROL_RATE = 8000

/**
 * Receiver hiss: broadband, slightly pink-tilted noise (60 % white, 40 % pink).
 * Peak-normalised to ~0.5 σ=1 so the graph can trim it with a plain gain.
 */
export function renderHiss(seconds: number, rand: Rand, rate = TEXTURE_RATE): Float32Array {
  const n = Math.round(seconds * rate)
  const out = new Float32Array(n)
  // Paul Kellet's economy pink filter
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < n; i++) {
    const w = gauss(rand)
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
    b6 = w * 0.115926
    out[i] = 0.6 * w + 0.4 * pink * 3.2
  }
  normaliseRms(out, 0.25)
  return out
}

/**
 * Atmospheric / electrical static. A mix of three Poisson event types:
 *  - micro ticks (frying-pan texture)
 *  - pops (the audible "pi-pa" static)
 *  - rare crashes (short noise bursts, distant lightning / switch noise)
 */
export function renderCrackle(seconds: number, rand: Rand, rate = TEXTURE_RATE): Float32Array {
  const n = Math.round(seconds * rate)
  const out = new Float32Array(n)

  const add = (t0: number, amp: number, ms: number, tauMs: number, noisy: number) => {
    const i0 = Math.floor(t0 * rate)
    const len = Math.ceil((ms / 1000) * rate)
    const tau = (tauMs / 1000) * rate
    const sign = rand() < 0.5 ? -1 : 1
    for (let j = 0; j < len; j++) {
      const env = Math.exp(-j / tau)
      // a unipolar-ish spike followed by band-limited ringing
      const v = amp * env * (sign * (1 - noisy) * (j < 2 ? 1 : 0.35) + noisy * gauss(rand))
      out[(i0 + j) % n] += v
    }
  }

  for (let t = expo(rand, 1 / 9); t < seconds; t += expo(rand, 1 / 9)) {
    add(t, 0.05 * Math.exp(0.6 * gauss(rand)), 1.2, 0.35, 0.35)
  }
  for (let t = expo(rand, 1 / 0.7); t < seconds; t += expo(rand, 1 / 0.7)) {
    add(t, 0.22 * Math.exp(0.55 * gauss(rand)), 5, 1.1, 0.5)
  }
  for (let t = expo(rand, 13); t < seconds; t += expo(rand, 13)) {
    // crash: noise burst with a quick attack and an uneven decay
    const amp = 0.45 + 0.35 * rand()
    const len = Math.round((0.012 + 0.03 * rand()) * rate)
    const i0 = Math.floor(t * rate)
    for (let j = 0; j < len; j++) {
      const x = j / len
      const env = Math.min(1, j / (0.0015 * rate)) * Math.pow(1 - x, 1.6) * (0.7 + 0.3 * Math.sin(40 * x))
      out[(i0 + j) % n] += amp * env * gauss(rand)
    }
  }
  return out
}

/**
 * Short heterodyne whistles: a sine that glides a fraction of an octave while
 * it fades in and out, 0.25–0.9 s long, every 15–40 s.
 */
export function renderWhistles(seconds: number, rand: Rand, rate = TEXTURE_RATE): Float32Array {
  const n = Math.round(seconds * rate)
  const out = new Float32Array(n)
  for (let t = 4 + rand() * 10; t < seconds - 2; t += 15 + rand() * 25) {
    const dur = 0.25 + rand() * 0.65
    const fa = 700 + rand() * 1700
    const fb = fa * (rand() < 0.5 ? 0.45 + rand() * 0.4 : 1.25 + rand() * 0.8)
    const amp = 0.5 + 0.5 * rand()
    const len = Math.round(dur * rate)
    const i0 = Math.floor(t * rate)
    let phase = 0
    for (let j = 0; j < len; j++) {
      const x = j / len
      const eased = x * x * (3 - 2 * x)
      const f = fa * Math.pow(fb / fa, eased) * (1 + 0.012 * Math.sin(2 * Math.PI * 6 * x * dur))
      phase += (2 * Math.PI * f) / rate
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.15)), 2) * Math.min(1, j / (0.03 * rate))
      out[i0 + j] += amp * env * Math.sin(phase)
    }
  }
  return out
}

// Rough vowel formants (F1, F2, F3) in Hz
const VOWELS: Array<[number, number, number]> = [
  [730, 1090, 2440], // a
  [530, 1840, 2480], // e
  [270, 2290, 3010], // i
  [570, 840, 2410], // o
  [300, 870, 2240], // u
]

/**
 * Adjacent-channel murmur: a crude vocoded "voice" (glottal buzz through
 * moving formant resonators, gated into syllables and words). Unintelligible
 * on purpose. A segment of 4–9 s appears every ~20–45 s with slow fades.
 */
export function renderBabble(seconds: number, rand: Rand, rate = TEXTURE_RATE): Float32Array {
  const n = Math.round(seconds * rate)
  const out = new Float32Array(n)

  const writeSegment = (start: number, len: number) => {
    const female = rand() < 0.4
    const f0base = female ? 170 + rand() * 60 : 95 + rand() * 40
    const total = Math.round(len * rate)
    const i0 = Math.floor(start * rate)

    // resonator state for three formants
    const z1 = [0, 0, 0]
    const z2 = [0, 0, 0]
    const coef = [[0, 0, 0], [0, 0, 0], [0, 0, 0]] // b0, a1, a2 per formant
    const setFormants = (fs: [number, number, number]) => {
      for (let k = 0; k < 3; k++) {
        const w0 = (2 * Math.PI * fs[k]) / rate
        const q = 6 + k * 3
        const alpha = Math.sin(w0) / (2 * q)
        const a0 = 1 + alpha
        coef[k][0] = alpha / a0
        coef[k][1] = (-2 * Math.cos(w0)) / a0
        coef[k][2] = (1 - alpha) / a0
      }
    }

    let phase = 0
    let sx2 = 0 // source delayed by two samples (bandpass numerator: b0 * (x - x[n-2]))
    let sx1 = 0
    let j = 0
    while (j < total) {
      // one word = 1..4 syllables, followed by a pause
      const syllables = 1 + Math.floor(rand() * 4)
      for (let s = 0; s < syllables && j < total; s++) {
        const slen = Math.round((0.11 + rand() * 0.17) * rate)
        const v0 = VOWELS[Math.floor(rand() * VOWELS.length)]
        const v1 = VOWELS[Math.floor(rand() * VOWELS.length)]
        const pitchDrift = (rand() - 0.5) * 0.25
        for (let k = 0; k < slen && j < total; k++, j++) {
          const x = k / slen
          if ((k & 63) === 0) {
            setFormants([
              v0[0] + (v1[0] - v0[0]) * x,
              v0[1] + (v1[1] - v0[1]) * x,
              v0[2] + (v1[2] - v0[2]) * x,
            ])
          }
          const f0 = f0base * (1 + pitchDrift * x) * (1 + 0.015 * Math.sin(j / rate * 31))
          phase += f0 / rate
          phase -= Math.floor(phase)
          const src = (2 * phase - 1) * 0.8 + 0.25 * gauss(rand)
          let y = 0
          for (let f = 0; f < 3; f++) {
            const [b0, a1, a2] = coef[f]
            const o = b0 * (src - sx2) - a1 * z1[f] - a2 * z2[f]
            z2[f] = z1[f]
            z1[f] = o
            y += o * (f === 0 ? 1 : f === 1 ? 1 : 0.7)
          }
          sx2 = sx1
          sx1 = src
          const syl = Math.sin(Math.PI * x) ** 0.7
          const seg = Math.min(1, Math.min(j / (1.5 * rate), (total - j) / (1.5 * rate)))
          const idx = (i0 + j) % n
          out[idx] += y * syl * seg * 3
        }
      }
      j += Math.round((0.08 + rand() * 0.35) * rate)
    }
  }

  for (let t = 3 + rand() * 12; t < seconds - 10; t += 20 + rand() * 25) {
    writeSegment(t, 4 + rand() * 5)
  }
  normalisePeak(out, 1)
  return out
}

function periodicNoise(
  n: number,
  rate: number,
  rand: Rand,
  fLo: number,
  fHi: number,
  parts: number,
): Float32Array {
  // Sum of sinusoids with an integer number of cycles per loop => seamless loop.
  const out = new Float32Array(n)
  const seconds = n / rate
  for (let p = 0; p < parts; p++) {
    const cycles = Math.max(1, Math.round((fLo + rand() * (fHi - fLo)) * seconds))
    const amp = 0.4 + rand() * 0.6
    const ph = rand() * 2 * Math.PI
    for (let i = 0; i < n; i++) out[i] += amp * Math.sin((2 * Math.PI * cycles * i) / n + ph)
  }
  return out
}

/**
 * Slow signal-strength curve in [0,1]: 0 = strong, 1 = deepest fade.
 * Gentle swells (carrier "breathing") plus occasional dips that last
 * 0.5–2.5 s with a few Hz of selective-fading ripple. Loops seamlessly.
 */
export function renderFade(seconds: number, rand: Rand, rate = CONTROL_RATE): Float32Array {
  const n = Math.round(seconds * rate)
  const out = new Float32Array(n)

  const slow = periodicNoise(n, rate, rand, 0.04, 0.12, 5)
  const mid = periodicNoise(n, rate, rand, 0.2, 0.6, 6)
  let sMax = 0
  let mMax = 0
  for (let i = 0; i < n; i++) {
    sMax = Math.max(sMax, Math.abs(slow[i]))
    mMax = Math.max(mMax, Math.abs(mid[i]))
  }
  for (let i = 0; i < n; i++) {
    out[i] = 0.12 + 0.1 * (slow[i] / sMax) + 0.05 * (mid[i] / mMax)
  }

  for (let t = expo(rand, 24); t < seconds; t += 8 + expo(rand, 22)) {
    const depth = 0.35 + 0.65 * rand() ** 0.8
    const dur = 0.5 + rand() * 2
    const rippleHz = 2 + rand() * 4
    const len = Math.round(dur * rate)
    const i0 = Math.floor(t * rate)
    for (let j = 0; j < len; j++) {
      const x = j / len
      // quick drop, slower recovery
      const shape = x < 0.2 ? Math.sin((x / 0.2) * (Math.PI / 2)) : Math.cos(((x - 0.2) / 0.8) * (Math.PI / 2))
      const ripple = 0.8 + 0.2 * Math.sin(2 * Math.PI * rippleHz * x * dur)
      out[(i0 + j) % n] += depth * shape * shape * ripple
    }
  }
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, out[i]))
  return out
}

/** Zero-mean 2–9 Hz amplitude flutter, ±1, slowly varying strength. Loops seamlessly. */
export function renderFlutter(seconds: number, rand: Rand, rate = CONTROL_RATE): Float32Array {
  const n = Math.round(seconds * rate)
  const carrier = periodicNoise(n, rate, rand, 2, 9, 8)
  const strength = periodicNoise(n, rate, rand, 0.1, 0.3, 3)
  const out = new Float32Array(n)
  let m = 0
  for (let i = 0; i < n; i++) {
    out[i] = carrier[i] * (1.2 + strength[i] / 3)
    m = Math.max(m, Math.abs(out[i]))
  }
  for (let i = 0; i < n; i++) out[i] /= m
  return out
}

function normaliseRms(buf: Float32Array, target: number) {
  let s = 0
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
  const g = target / Math.sqrt(s / buf.length)
  for (let i = 0; i < buf.length; i++) buf[i] *= g
}

function normalisePeak(buf: Float32Array, target: number) {
  let m = 0
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]))
  if (m === 0) return
  const g = target / m
  for (let i = 0; i < buf.length; i++) buf[i] *= g
}

export function toBuffer(ctx: BaseAudioContext, data: Float32Array, rate: number): AudioBuffer {
  const buf = ctx.createBuffer(1, data.length, rate)
  buf.getChannelData(0).set(data)
  return buf
}
