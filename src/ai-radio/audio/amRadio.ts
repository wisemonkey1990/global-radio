// Old medium-wave / valve radio simulation built from plain Web Audio nodes.
//
// Signal flow of the "radio" branch (everything mono):
//
//   program ─ mono sum ─ transmitter HP/LP ─ drive ─ pre-amp shaper (even-harmonic) ─ DC block
//           ─ carrier fading ─┐
//   hiss / static / whistle / murmur ───────┴─ IF filter (8th-order, ~3 kHz) ─ AGC
//           ─ + mains hum ─ output-stage shaper (soft, asymmetric) ─ DC block
//           ─ small paper-cone speaker + cabinet ─ trim ─ master
//
// Noise is injected *before* the IF filter and the AGC, so, as in a real set, it is
// band limited like the program and rises when the AGC lifts quiet passages
// and when the carrier fades. Only native nodes are used (no AudioWorklet), so it also
// runs on plain-http origins and offline contexts.

import {
  CONTROL_RATE,
  TEXTURE_RATE,
  mulberry32,
  renderBabble,
  renderCrackle,
  renderFade,
  renderFlutter,
  renderHiss,
  renderWhistles,
  toBuffer,
} from './noise'

export type RadioMode = 'clean' | 'mw' | 'tube'
export type RadioVoice = Exclude<RadioMode, 'clean'>

export interface AmRadioOptions {
  mode?: RadioMode
  mainsHz?: 50 | 60
  seed?: number
}

export interface AmRadio {
  input: AudioNode
  output: AudioNode
  setMode(mode: RadioMode): void
  setMains(hz: 50 | 60): void
  /** 0..1.5 scale for every noise/hum/static source (1 = nominal). */
  setAmbience(amount: number): void
  /** Cheaper processing for when the screen is off (CPU is throttled and the audio thread starves). */
  setEco(on: boolean): void
  /** Short tuning sweep: squeal glide + burst of hiss and murmur. */
  tuneSweep(): void
  /** Current simulated fade, 0 (strong signal) … 1 (deep fade). */
  fadeNow(): number
  /** Biquads of the linear signal path (for measurements). */
  linearPath: BiquadFilterNode[]
  dispose(): void
}

const qDb = (q: number) => 20 * Math.log10(q) // lowpass/highpass Q is in dB in Web Audio
// 8th-order Butterworth split into four biquads
const BUTTERWORTH8_Q = [0.5098, 0.6013, 0.9, 2.5629]

interface Profile {
  txHp: number
  txLp: number
  drive: number
  ifLp: number
  agc: { threshold: number; knee: number; ratio: number; attack: number; release: number }
  hiss: number
  crackle: number
  whistle: number
  babble: number
  hum: number
  /** how strongly the noise floor swells while the carrier fades */
  fadeNoise: number
  powerDrive: number
  speaker: {
    hp: number
    hpQ: number
    peaks: Array<[freq: number, gainDb: number, q: number]>
    lp: number
    lpQ: number
    combDelay: number
    combGain: number
  }
  trim: number
}

const PROFILES: Record<RadioVoice, Profile> = {
  // Early transistor pocket set: narrow, tinny, hissy, a lot of static.
  mw: {
    txHp: 90,
    txLp: 5000,
    drive: 1.2,
    ifLp: 3000,
    agc: { threshold: -30, knee: 20, ratio: 2.8, attack: 0.02, release: 0.3 },
    hiss: 0.0081,
    crackle: 0.18,
    whistle: 0.016,
    babble: 0.018,
    hum: 0.0025,
    fadeNoise: 1.2,
    powerDrive: 1.05,
    speaker: {
      hp: 190,
      hpQ: 0.9,
      peaks: [[460, 3, 1.6], [1800, 3, 1], [2500, 1, 3.5]],
      lp: 3800,
      lpQ: 0.8,
      combDelay: 0.0008,
      combGain: 0.15,
    },
    trim: 0.4,
  },
  // Valve table set: a little more body, warmer and dirtier, audible mains hum, slower AGC.
  tube: {
    txHp: 60,
    txLp: 5200,
    drive: 1.05,
    ifLp: 3200,
    agc: { threshold: -28, knee: 24, ratio: 2.2, attack: 0.04, release: 0.6 },
    hiss: 0.0058,
    crackle: 0.17,
    whistle: 0.012,
    babble: 0.016,
    hum: 0.006,
    fadeNoise: 1.5,
    powerDrive: 1.15,
    speaker: {
      hp: 140,
      hpQ: 0.8,
      peaks: [[250, 3, 1.3], [1400, 3, 0.9], [2300, 1.5, 3]],
      lp: 3600,
      lpQ: 0.7,
      combDelay: 0.0012,
      combGain: 0.18,
    },
    trim: 0.49,
  },
}

/** Pre-amp transfer curve: tanh with a bias, so the positive and negative half-waves are
 *  squashed differently => 2nd harmonic ("warm") on top of the 3rd from saturation. */
function preampCurve(k: number, bias: number, n = 4096): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(n)
  const t0 = Math.tanh(k * bias)
  const slope = k * (1 - t0 * t0)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = (Math.tanh(k * (x + bias)) - t0) / slope
  }
  return curve
}

/** Output stage: soft limiting whose negative swing clips later than the positive one. */
function powerCurve(k: number, asym: number, n = 4096): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = x >= 0 ? Math.tanh(k * x) / k : (Math.tanh((k * x) / (1 + asym)) * (1 + asym)) / k
  }
  return curve
}

const PREAMP_SHAPES: Record<RadioVoice, [k: number, bias: number]> = {
  mw: [2.0, 0.16],
  tube: [1.8, 0.16],
}
const POWER_SHAPES: Record<RadioVoice, [k: number, asym: number]> = {
  mw: [1.3, 0.2],
  tube: [1.5, 0.25],
}

export function createAmRadio(ctx: BaseAudioContext, options: AmRadioOptions = {}): AmRadio {
  const rand = mulberry32(options.seed ?? (Math.random() * 2 ** 32) >>> 0)
  const sources: AudioScheduledSourceNode[] = []
  const linearPath: BiquadFilterNode[] = []
  let mode: RadioMode = options.mode ?? 'mw'
  let mains: 50 | 60 = options.mainsHz ?? 50
  let ambience = 1

  const gain = (value = 1) => {
    const g = ctx.createGain()
    g.gain.value = value
    return g
  }
  const biquad = (type: BiquadFilterType, freq: number, q: number, gainDb = 0, linear = true) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    f.gain.value = gainDb
    if (linear) linearPath.push(f)
    return f
  }
  const chain = (nodes: AudioNode[]) => {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
    return { first: nodes[0], last: nodes[nodes.length - 1] }
  }
  const loopSource = (data: Float32Array, rate: number, node: AudioNode) => {
    const src = ctx.createBufferSource()
    src.buffer = toBuffer(ctx, data, rate)
    src.loop = true
    src.connect(node)
    const offset = rand() * src.buffer.duration
    src.start(0, offset)
    sources.push(src)
    return { src, offset, duration: src.buffer.duration }
  }

  // ---------------------------------------------------------------- program path
  const input = gain(1)
  const dry = gain(mode === 'clean' ? 1 : 0)
  const wet = gain(mode === 'clean' ? 0 : 1)
  const master = gain(1)
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.knee.value = 3
  limiter.ratio.value = 12
  limiter.attack.value = 0.002
  limiter.release.value = 0.12

  input.connect(dry).connect(master)

  const mono = gain(1)
  mono.channelCount = 1
  mono.channelCountMode = 'explicit'
  mono.channelInterpretation = 'speakers'
  input.connect(mono)

  const txHp = biquad('highpass', 90, qDb(0.707))
  const txLp1 = biquad('lowpass', 5000, qDb(0.707))
  const txLp2 = biquad('lowpass', 5000, qDb(0.707))
  const drive = gain(1.4)

  const shapers: WaveShaperNode[] = []
  const shaper = (curve: Float32Array<ArrayBuffer>) => {
    const s = ctx.createWaveShaper()
    s.curve = curve
    s.oversample = '2x'
    shapers.push(s)
    return s
  }
  const voices: RadioVoice[] = ['mw', 'tube']
  const preSel = { mw: gain(0), tube: gain(0) }
  const preSum = gain(1)
  const pre = {} as Record<RadioVoice, WaveShaperNode>
  for (const v of voices) {
    pre[v] = shaper(preampCurve(...PREAMP_SHAPES[v]))
    pre[v].connect(preSel[v])
    preSel[v].connect(preSum)
  }
  const dc1 = biquad('highpass', 20, qDb(0.707), 0, false)
  const carrier = gain(1)
  const ifIn = gain(1)
  chain([mono, txHp, txLp1, txLp2, drive])
  chain([preSum, dc1, carrier, ifIn])

  const ifStages = BUTTERWORTH8_Q.map((q) => biquad('lowpass', 3000, qDb(q)))
  chain([ifIn, ...ifStages])

  const agc = ctx.createDynamicsCompressor()
  agc.threshold.value = -34
  agc.knee.value = 16
  agc.ratio.value = 4
  agc.attack.value = 0.02
  agc.release.value = 0.3
  ifStages[ifStages.length - 1].connect(agc)

  const afterAgc = gain(1)
  agc.connect(afterAgc)

  // mains hum: ripple is mostly 2nd harmonic of the mains frequency
  const humGain = gain(0)
  const humOscs = [1, 2, 3, 4].map((h, i) => {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = mains * h
    const g = gain([0.35, 1, 0.45, 0.2][i])
    o.connect(g).connect(humGain)
    o.start()
    sources.push(o)
    return o
  })
  humGain.connect(afterAgc)

  const powDrive = gain(1.2)
  const powSel = { mw: gain(0), tube: gain(0) }
  const powSum = gain(1)
  afterAgc.connect(powDrive)
  const pow = {} as Record<RadioVoice, WaveShaperNode>
  for (const v of voices) {
    pow[v] = shaper(powerCurve(...POWER_SHAPES[v]))
    pow[v].connect(powSel[v])
    powSel[v].connect(powSum)
  }

  // Only the shapers of the active voice (and only the radio branch at all) are wired up: oversampled
  // waveshapers are the heaviest nodes here, and phones starve the audio thread when the screen is off.
  const attached = new Set<RadioVoice>()
  const attach = (v: RadioVoice, on: boolean) => {
    if (on === attached.has(v)) return
    if (on) {
      drive.connect(pre[v])
      powDrive.connect(pow[v])
      attached.add(v)
    } else {
      drive.disconnect(pre[v])
      powDrive.disconnect(pow[v])
      attached.delete(v)
    }
  }
  let wetLinked = false
  const linkWet = (on: boolean) => {
    if (on === wetLinked) return
    if (on) wet.connect(master)
    else wet.disconnect(master)
    wetLinked = on
  }
  const dc2 = biquad('highpass', 20, qDb(0.707), 0, false)

  // speaker + cabinet
  const spHp = biquad('highpass', 190, qDb(0.9))
  const spPeaks = [0, 1, 2].map(() => biquad('peaking', 1000, 1, 0))
  const spLp = biquad('lowpass', 3800, qDb(0.8))
  const combIn = gain(1)
  const combDelay = ctx.createDelay(0.01)
  const combGain = gain(0.15)
  const combOut = gain(1)
  combIn.connect(combOut)
  combIn.connect(combDelay).connect(combGain).connect(combOut)
  const trim = gain(0.8)
  chain([powSum, dc2, spHp, ...spPeaks, spLp, combIn])
  combOut.connect(trim).connect(wet)
  master.connect(limiter)

  // ---------------------------------------------------------------- air: noise & friends
  const ambienceBus = gain(1)
  ambienceBus.connect(ifIn)

  const hissGain = gain(0)
  const hissBus = gain(1)
  hissBus.connect(hissGain).connect(ambienceBus)
  loopSource(renderHiss(13, rand), TEXTURE_RATE, hissBus)
  loopSource(renderHiss(19, rand), TEXTURE_RATE, hissBus)

  const crackleGain = gain(0)
  const crackleBus = gain(1)
  crackleBus.connect(crackleGain).connect(ambienceBus)
  loopSource(renderCrackle(29, rand), TEXTURE_RATE, crackleBus)
  loopSource(renderCrackle(43, rand), TEXTURE_RATE, crackleBus)

  const whistleGain = gain(0)
  loopSource(renderWhistles(37, rand), TEXTURE_RATE, whistleGain)
  whistleGain.connect(ambienceBus)

  const babbleGain = gain(0)
  const babbleBus = gain(1)
  babbleBus.connect(babbleGain).connect(ambienceBus)
  loopSource(renderBabble(53, rand), TEXTURE_RATE, babbleBus)

  // fading + flutter: control-rate loops that drive AudioParams on the audio thread
  const fadeData = renderFade(97, rand)
  const fadeNode = gain(1)
  const fade = loopSource(fadeData, CONTROL_RATE, fadeNode)
  const fadeToSignal = gain(-0.5)
  const fadeToHiss = gain(0)
  const fadeToCrackle = gain(0)
  fadeNode.connect(fadeToSignal).connect(carrier.gain)
  fadeNode.connect(fadeToHiss).connect(hissGain.gain)
  fadeNode.connect(fadeToCrackle).connect(crackleGain.gain)

  const flutterGain = gain(0.02)
  loopSource(renderFlutter(11, rand), CONTROL_RATE, flutterGain)
  flutterGain.connect(carrier.gain)

  const fadeStart = ctx.currentTime

  // ---------------------------------------------------------------- mode handling
  const SMOOTH = 0.03 // time constant of parameter glides (s)
  let instant = true // while building: set values directly instead of gliding

  const glide = (p: AudioParam, v: number, tc = SMOOTH) => {
    if (instant) p.value = v
    else p.setTargetAtTime(v, ctx.currentTime, tc)
  }

  function applyAmbience() {
    glide(ambienceBus.gain, ambience, 0.05)
    const hum = mode === 'clean' ? 0 : PROFILES[mode].hum
    glide(humGain.gain, hum * ambience)
  }

  /** After the cross-fade has finished, stop processing whatever is no longer audible. */
  function pruneLater() {
    const keep = mode
    const prune = () => {
      if (mode !== keep) return
      if (keep === 'clean') linkWet(false)
      for (const v of voices) if (v !== keep) attach(v, false)
    }
    if (instant) prune()
    else setTimeout(prune, 150)
  }

  function applyMode() {
    glide(dry.gain, mode === 'clean' ? 1 : 0, 0.02)
    glide(wet.gain, mode === 'clean' ? 0 : 1, 0.02)
    if (mode !== 'clean') {
      linkWet(true)
      attach(mode, true)
    }
    pruneLater()
    if (mode === 'clean') {
      applyAmbience()
      return
    }
    const p = PROFILES[mode]
    glide(txHp.frequency, p.txHp)
    glide(txLp1.frequency, p.txLp)
    glide(txLp2.frequency, p.txLp)
    glide(drive.gain, p.drive)
    for (const s of ifStages) glide(s.frequency, p.ifLp)
    glide(agc.threshold, p.agc.threshold)
    glide(agc.knee, p.agc.knee)
    glide(agc.ratio, p.agc.ratio)
    glide(agc.attack, p.agc.attack)
    glide(agc.release, p.agc.release)
    glide(hissGain.gain, p.hiss)
    glide(fadeToHiss.gain, p.hiss * p.fadeNoise)
    glide(crackleGain.gain, p.crackle)
    glide(fadeToCrackle.gain, p.crackle * p.fadeNoise * 1.5)
    glide(whistleGain.gain, p.whistle)
    glide(babbleGain.gain, p.babble)
    glide(powDrive.gain, p.powerDrive)
    glide(spHp.frequency, p.speaker.hp)
    glide(spHp.Q, qDb(p.speaker.hpQ))
    p.speaker.peaks.forEach(([f, g, q], i) => {
      glide(spPeaks[i].frequency, f)
      glide(spPeaks[i].gain, g)
      glide(spPeaks[i].Q, q)
    })
    glide(spLp.frequency, p.speaker.lp)
    glide(spLp.Q, qDb(p.speaker.lpQ))
    glide(combDelay.delayTime, p.speaker.combDelay)
    glide(combGain.gain, p.speaker.combGain)
    glide(trim.gain, p.trim)
    for (const v of voices) {
      glide(preSel[v].gain, v === mode ? 1 : 0, 0.02)
      glide(powSel[v].gain, v === mode ? 1 : 0, 0.02)
    }
    applyAmbience()
  }

  // initialise parameters directly (no audible glide at construction)
  applyMode()
  instant = false

  function tuneSweep() {
    if (mode === 'clean') return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = gain(0)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(2900, t)
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.5)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.05, t + 0.06)
    g.gain.linearRampToValueAtTime(0.012, t + 0.35)
    g.gain.linearRampToValueAtTime(0, t + 0.55)
    osc.connect(g).connect(ambienceBus)
    osc.start(t)
    osc.stop(t + 0.6)

    const burst = gain(0)
    hissBus.connect(burst).connect(ambienceBus)
    const pk = mode === 'mw' ? 0.09 : 0.07
    burst.gain.setValueAtTime(0, t)
    burst.gain.linearRampToValueAtTime(pk, t + 0.05)
    burst.gain.linearRampToValueAtTime(pk * 0.6, t + 0.4)
    burst.gain.linearRampToValueAtTime(0, t + 0.7)

    const murmur = gain(0)
    babbleBus.connect(murmur).connect(ambienceBus)
    murmur.gain.setValueAtTime(0, t + 0.1)
    murmur.gain.linearRampToValueAtTime(0.05, t + 0.25)
    murmur.gain.linearRampToValueAtTime(0, t + 0.6)
    setTimeout(() => {
      burst.disconnect()
      murmur.disconnect()
    }, 1200)
  }

  const fadeNow = () => {
    const pos = (fade.offset + (ctx.currentTime - fadeStart)) % fade.duration
    return fadeData[Math.floor(pos * CONTROL_RATE) % fadeData.length]
  }

  return {
    input,
    output: limiter,
    linearPath: [txHp, txLp1, txLp2, ...ifStages, spHp, ...spPeaks, spLp],
    setMode(next) {
      if (next === mode) return
      mode = next
      applyMode()
    },
    setMains(hz) {
      mains = hz
      humOscs.forEach((o, i) => glide(o.frequency, hz * (i + 1)))
    },
    setAmbience(amount) {
      ambience = amount
      applyAmbience()
    },
    tuneSweep,
    fadeNow,
    setEco(on) {
      // no oversampling while the page is hidden (screen locked): aliasing on a lo-fi radio is inaudible
      for (const s of shapers) s.oversample = on ? 'none' : '2x'
    },
    dispose() {
      for (const s of sources) {
        try {
          s.stop()
        } catch {
          /* already stopped */
        }
      }
      limiter.disconnect()
      input.disconnect()
    },
  }
}
