// Built-in "house band": a tiny generative sequencer used as an always-available
// station (offline, or when an internet stream is blocked). One style per preset.

import type { PresetId } from '../data'

type Drums = 'none' | 'brush' | 'lofi' | 'pop' | 'drive' | 'four' | 'triplet'

interface Style {
  bpm: number
  swing?: number
  stepsPerBar: 16 | 12
  /** chord roots (MIDI) and intervals, one chord per bar unless `barsPerChord` is set */
  chords: Array<{ root: number; q: number[] }>
  barsPerChord?: number
  drums: Drums
  /** comp hits per bar (step indexes) */
  comp: number[]
  compKind: 'epiano' | 'pluck' | 'saw' | 'none'
  arp?: boolean
  pad?: boolean
  bass: number[]
  bell?: boolean
}

const MAJ7 = [0, 4, 7, 11]
const MIN9 = [0, 3, 7, 10, 14]
const DOM9 = [0, 4, 7, 10, 14]
const MAJ9 = [0, 4, 7, 11, 14]
const MAJ = [0, 4, 7]
const MIN = [0, 3, 7]
const MIN7 = [0, 3, 7, 10]
const SUS = [0, 5, 7, 12]

const STYLES: Record<PresetId, Style> = {
  mood: {
    bpm: 80, swing: 0.2, stepsPerBar: 16, drums: 'lofi', compKind: 'epiano', comp: [0, 6, 10], bass: [0, 8],
    chords: [{ root: 50, q: MIN9 }, { root: 43, q: DOM9 }, { root: 48, q: MAJ9 }, { root: 45, q: MIN9 }],
  },
  discover: {
    bpm: 100, stepsPerBar: 16, drums: 'pop', compKind: 'pluck', comp: [0, 2, 4, 6, 8, 10, 12, 14], arp: true, bass: [0, 4, 8, 12],
    chords: [{ root: 50, q: MAJ }, { root: 57, q: MAJ }, { root: 59, q: MIN }, { root: 55, q: MAJ }],
  },
  focus: {
    bpm: 60, stepsPerBar: 16, drums: 'none', compKind: 'none', comp: [], bass: [0], pad: true, bell: true, barsPerChord: 2,
    chords: [{ root: 48, q: MAJ7 }, { root: 45, q: MIN9 }, { root: 53, q: MAJ7 }, { root: 55, q: SUS }],
  },
  road: {
    bpm: 112, stepsPerBar: 16, drums: 'drive', compKind: 'pluck', comp: [0, 3, 6, 8, 11, 14], arp: true, bass: [0, 2, 4, 6, 8, 10, 12, 14],
    chords: [{ root: 55, q: MAJ }, { root: 50, q: MAJ }, { root: 52, q: MIN }, { root: 48, q: MAJ }],
  },
  night: {
    bpm: 62, swing: 0.1, stepsPerBar: 16, drums: 'brush', compKind: 'epiano', comp: [0, 10], bass: [0], pad: true, bell: true,
    chords: [{ root: 45, q: MIN9 }, { root: 41, q: MAJ7 }, { root: 50, q: MIN9 }, { root: 40, q: DOM9 }],
  },
  oldies: {
    bpm: 76, stepsPerBar: 12, drums: 'triplet', compKind: 'epiano', comp: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], bass: [0, 6],
    chords: [{ root: 53, q: MAJ }, { root: 50, q: MIN }, { root: 46, q: MAJ }, { root: 48, q: MAJ }],
  },
  sport: {
    bpm: 128, stepsPerBar: 16, drums: 'four', compKind: 'saw', comp: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], arp: true, bass: [0, 2, 4, 6, 8, 10, 12, 14],
    chords: [{ root: 57, q: MIN7 }, { root: 53, q: MAJ }, { root: 48, q: MAJ }, { root: 55, q: MAJ }],
  },
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export interface Generative {
  stop(): void
}

export function startGenerative(ctx: AudioContext, out: AudioNode, id: PresetId): Generative {
  const style = STYLES[id]
  const master = ctx.createGain()
  master.gain.value = 0
  master.gain.setTargetAtTime(0.6, ctx.currentTime, 0.4)
  master.connect(out)

  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const nd = noise.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

  const env = (g: GainNode, t: number, peak: number, attack: number, decay: number) => {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  }
  const osc = (type: OscillatorType, f: number, t: number, dur: number, dest: AudioNode) => {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = f
    o.connect(dest)
    o.start(t)
    o.stop(t + dur)
    return o
  }
  const voice = (peak: number, attack: number, decay: number, t: number) => {
    const g = ctx.createGain()
    env(g, t, peak, attack, decay)
    g.connect(master)
    return g
  }

  const epiano = (m: number, t: number, vel: number) => {
    const f = mtof(m)
    const g = voice(0.2 * vel, 0.004, 1.4, t)
    osc('sine', f, t, 1.6, g)
    const bell = ctx.createGain()
    env(bell, t, 0.07 * vel, 0.002, 0.25)
    bell.connect(g)
    osc('sine', f * 4, t, 0.3, bell)
    const tine = ctx.createGain()
    env(tine, t, 0.05 * vel, 0.002, 0.9)
    tine.connect(g)
    osc('triangle', f * 2, t, 1, tine)
  }
  const pluck = (m: number, t: number, vel: number) => {
    const g = voice(0.16 * vel, 0.003, 0.5, t)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(3200, t)
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.4)
    lp.connect(g)
    osc('sawtooth', mtof(m), t, 0.6, lp)
  }
  const saw = (m: number, t: number, vel: number) => {
    const g = voice(0.1 * vel, 0.004, 0.16, t)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1800
    lp.Q.value = 4
    lp.connect(g)
    osc('sawtooth', mtof(m), t, 0.25, lp)
    osc('sawtooth', mtof(m) * 1.006, t, 0.25, lp)
  }
  const pad = (notes: number[], t: number, dur: number) => {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.05, t + 1.5)
    g.gain.setValueAtTime(0.05, t + dur - 0.5)
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.5)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 900
    lp.connect(g)
    g.connect(master)
    for (const m of notes) {
      osc('sawtooth', mtof(m) * 0.997, t, dur + 1.6, lp)
      osc('sawtooth', mtof(m) * 1.003, t, dur + 1.6, lp)
    }
  }
  const bell = (m: number, t: number) => {
    const g = voice(0.06, 0.003, 2.2, t)
    osc('sine', mtof(m), t, 2.3, g)
    osc('sine', mtof(m) * 2.76, t, 0.6, voice(0.015, 0.002, 0.5, t))
  }
  const bass = (m: number, t: number, len: number) => {
    const g = voice(0.34, 0.01, len, t)
    osc('sine', mtof(m), t, len + 0.1, g)
    osc('triangle', mtof(m), t, len + 0.1, voice(0.08, 0.01, len * 0.7, t))
  }
  const kick = (t: number, v = 1) => {
    const g = voice(0.9 * v, 0.002, 0.32, t)
    const o = osc('sine', 130, t, 0.4, g)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14)
  }
  const noiseHit = (t: number, type: BiquadFilterType, freq: number, peak: number, decay: number, q = 0.8) => {
    const src = ctx.createBufferSource()
    src.buffer = noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = voice(peak, 0.001, decay, t)
    src.connect(f).connect(g)
    src.start(t, Math.random() * 0.5)
    src.stop(t + decay + 0.05)
  }
  const hat = (t: number, v = 1) => noiseHit(t, 'highpass', 7000, 0.12 * v, 0.045)
  const snare = (t: number, v = 1) => {
    noiseHit(t, 'bandpass', 1900, 0.4 * v, 0.14, 0.9)
    const g = voice(0.2 * v, 0.001, 0.09, t)
    osc('triangle', 190, t, 0.12, g)
  }
  const brush = (t: number, v = 1) => noiseHit(t, 'bandpass', 4500, 0.1 * v, 0.2, 0.5)

  const spb = 60 / style.bpm
  const stepDur = style.stepsPerBar === 12 ? spb / 3 : spb / 4
  const barDur = stepDur * style.stepsPerBar
  const bpc = style.barsPerChord ?? 1
  const pent = [0, 2, 4, 7, 9]

  let nextTime = ctx.currentTime + 0.15
  let step = 0

  const schedule = (s: number, t: number) => {
    const bar = Math.floor(s / style.stepsPerBar)
    const k = s % style.stepsPerBar
    const chord = style.chords[Math.floor(bar / bpc) % style.chords.length]
    const notes = chord.q.map((i) => chord.root + 12 + i)
    const swing = style.swing && k % 2 === 1 ? stepDur * style.swing : 0
    const tt = t + swing
    const vel = 0.75 + Math.random() * 0.25

    if (style.pad && k === 0 && bar % bpc === 0) pad(notes, tt, barDur * bpc)

    if (style.comp.includes(k)) {
      const idx = k % notes.length
      const m = style.arp ? notes[idx] + (k % 8 === 7 ? 12 : 0) : notes[idx % notes.length]
      const play = style.compKind === 'epiano' ? epiano : style.compKind === 'pluck' ? pluck : style.compKind === 'saw' ? saw : null
      if (play) {
        if (style.arp || style.stepsPerBar === 12) play(m, tt, vel)
        else notes.slice(0, 4).forEach((n, i) => play(n, tt + i * 0.012, vel * 0.8))
      }
    }

    if (style.bass.includes(k)) {
      const bm = chord.root - 12 + (k === 8 && style.drums !== 'four' && style.drums !== 'drive' ? 7 : 0)
      bass(bm, tt, stepDur * (style.bass.length > 4 ? 1.4 : style.bass.length * 3.2))
    }

    if (style.bell && Math.random() < 0.09 && k % 2 === 0) {
      bell(chord.root + 24 + pent[Math.floor(Math.random() * pent.length)], tt)
    }

    switch (style.drums) {
      case 'lofi':
        if (k === 0 || k === 10) kick(tt, 0.9)
        if (k === 4 || k === 12) snare(tt, 0.55)
        if (k % 2 === 0) hat(tt, k % 4 === 0 ? 0.7 : 0.4)
        break
      case 'pop':
        if (k === 0 || k === 8 || k === 11) kick(tt)
        if (k === 4 || k === 12) snare(tt, 0.7)
        if (k % 2 === 0) hat(tt, 0.6)
        break
      case 'drive':
        if (k % 4 === 0) kick(tt, 0.9)
        if (k === 4 || k === 12) snare(tt, 0.8)
        if (k % 2 === 0) hat(tt, 0.55)
        break
      case 'four':
        if (k % 4 === 0) kick(tt)
        if (k % 4 === 2) hat(tt, 0.7)
        if (k === 4 || k === 12) snare(tt, 0.6)
        break
      case 'brush':
        if (k % 4 === 2) brush(tt, 0.7)
        if (k === 0) kick(tt, 0.4)
        break
      case 'triplet':
        if (k === 0 || k === 6) kick(tt, 0.7)
        if (k === 3 || k === 9) brush(tt, 1.5)
        break
      default:
        break
    }
  }

  const timer = setInterval(() => {
    // look ahead 2 s so a throttled background timer still keeps the beat
    while (nextTime < ctx.currentTime + 2) {
      schedule(step, nextTime)
      nextTime += stepDur
      step++
    }
  }, 250)

  return {
    stop() {
      clearInterval(timer)
      master.gain.cancelScheduledValues(ctx.currentTime)
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.1)
      // let already-scheduled notes finish silently, then drop the graph
      setTimeout(() => master.disconnect(), 800)
    },
  }
}
