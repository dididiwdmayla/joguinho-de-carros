/**
 * Procedural engine sound. No samples: every noise the car makes is built out
 * of oscillators and filtered noise, driven straight off the powertrain state.
 *
 * The whole graph is built once, when the browser first lets us open an audio
 * device, and never touched again -- a frame only writes numbers into audio
 * parameters. Nothing is ever assigned onto a parameter either: every value
 * arrives on a short ramp, because a value set straight onto a running graph is
 * a step in the waveform, and a step is a click.
 *
 * The chain reads the same way the powertrain does:
 *
 *   harmonics of the firing frequency -.
 *                                       >- mix -> low-pass -> level -> master
 *   band-passed noise (the body) ------'                        ^        |
 *                                                           slip beat    |
 *   bright noise (the wheels letting go) ----------------------------->--'
 */
import { clamp, lerp } from '../core/math'
import type { PowertrainState } from '../vehicle/powertrain'
import type { EngineAudioParams } from './audioParams'

/** Seconds of noise looped underneath everything. */
const NOISE_SECONDS = 2

/** Where the volume control starts. */
export const DEFAULT_VOLUME = 0.7

/** Filters and oscillators are kept inside sane audible bounds. */
const MIN_FILTER_HZ = 40
const MIN_OSCILLATOR_HZ = 5

/** What the synthesiser needs to know about the engine it is voicing. */
export interface EngineReference {
  readonly idleRpm: number
  readonly maxRpm: number
}

/** Where the sound is in its own little life cycle. */
type EnginePhase = 'silent' | 'cranking' | 'running' | 'dying'

/** Every node of the graph, built once and reused for the whole session. */
interface EngineVoice {
  readonly context: BaseAudioContext
  readonly compressor: DynamicsCompressorNode
  readonly master: GainNode
  readonly level: GainNode
  readonly lowpass: BiquadFilterNode
  readonly oscillators: readonly OscillatorNode[]
  readonly noiseBand: BiquadFilterNode
  readonly noiseGain: GainNode
  readonly spinBand: BiquadFilterNode
  readonly spinGain: GainNode
  readonly beat: OscillatorNode
  readonly beatDepth: GainNode
}

/** What the debug overlay needs in order to explain silence. */
export interface EngineAudioReadout {
  /** State of the device, or why there is not one. */
  state: string
  /** Gain actually written onto the master node this frame. */
  masterGain: number
  /** Firing frequency being voiced right now [Hz]. */
  fundamental: number
}

export interface EngineAudio {
  readonly params: EngineAudioParams
  /** Replaced when the engine's own numbers change under it. */
  engine: EngineReference
  /** Null until a gesture lets us open the device; silent but harmless. */
  voice: EngineVoice | null
  /** Player's mute switch. Off once the device opens, as asked. */
  muted: boolean
  /** Player's volume, 0..1, multiplying the bus level. */
  volume: number
  /** Refreshed every frame, whether or not there is a device to play through. */
  readonly readout: EngineAudioReadout
  /** False while the page is hidden, so a backgrounded tab never drones on. */
  audible: boolean
  phase: EnginePhase
  /** Seconds left of the death rattle. */
  dying: number
  /** Speed the engine was turning when it died [rpm]. */
  dyingRpm: number
  /** Last speed the engine was actually running at [rpm]. */
  lastRpm: number
}

export function createEngineAudio(
  params: EngineAudioParams,
  engine: EngineReference,
): EngineAudio {
  return {
    params,
    engine,
    voice: null,
    muted: false,
    volume: DEFAULT_VOLUME,
    readout: { state: 'sem contexto', masterGain: 0, fundamental: 0 },
    audible: true,
    phase: 'silent',
    dying: 0,
    dyingRpm: 0,
    lastRpm: engine.idleRpm,
  }
}

/**
 * Points the synthesiser at a different engine. Idle and the limiter are what
 * every pitch here is measured against, and a fuel is allowed to move both.
 */
export function setEngineReference(audio: EngineAudio, engine: EngineReference): void {
  audio.engine = engine
}

/** True once there is a device to play through. */
export function isEngineAudioReady(audio: EngineAudio): boolean {
  return audio.voice !== null
}

export function isEngineAudioMuted(audio: EngineAudio): boolean {
  return audio.muted
}

export function setEngineAudioMuted(audio: EngineAudio, muted: boolean): void {
  audio.muted = muted
}

export function toggleEngineAudioMuted(audio: EngineAudio): void {
  audio.muted = !audio.muted
}

export function setEngineAudioVolume(audio: EngineAudio, volume: number): void {
  audio.volume = clamp(volume, 0, 1)
}

/** A hidden page keeps no rendering loop, so the sound would freeze mid-note. */
export function setEngineAudioAudible(audio: EngineAudio, audible: boolean): void {
  audio.audible = audible
}

/**
 * Opens the audio device and builds the graph. Must be called from inside a
 * real user gesture -- every browser refuses to start audio before one -- and
 * does nothing at all if called twice or if the browser has no Web Audio.
 *
 * `context` is only for tests, which render the same graph offline; the game
 * always lets this open its own device.
 */
export function startEngineAudio(audio: EngineAudio, context?: BaseAudioContext): void {
  if (audio.voice !== null) return
  const opened = context ?? openContext()
  if (opened === null) return
  audio.voice = buildVoice(opened, audio.params)
}

/**
 * Opens the device if it is not open yet, and asks a suspended one to run.
 *
 * Must be called from inside a user gesture, and is meant to be called on
 * every one of them: creating the context is not enough, several browsers hand
 * back a suspended context and only a resume() from inside a gesture handler
 * moves it, and that resume can be refused more than once.
 */
export function resumeEngineAudio(audio: EngineAudio): void {
  startEngineAudio(audio)
  const context = audio.voice?.context
  if (context === undefined) return
  if (context.state === 'running') return
  const resumable = context as BaseAudioContext & { resume?: () => Promise<void> }
  if (typeof resumable.resume !== 'function') return
  try {
    void resumable.resume().catch(() => undefined)
  } catch {
    // A device that refuses to start is not a reason to stop the game.
  }
}

function openContext(): AudioContext | null {
  try {
    const owner = window as typeof window & { webkitAudioContext?: typeof AudioContext }
    const Constructor = window.AudioContext ?? owner.webkitAudioContext
    if (Constructor === undefined) return null
    const context = new Constructor()
    // Opening inside the gesture is usually enough, but a context that was
    // already suspended (a tab restored from the background) needs the nudge.
    void context.resume()
    return context
  } catch {
    // No audio device, or a browser that refuses to give us one. The game is
    // perfectly playable in silence; it must never fail to start over sound.
    return null
  }
}

function buildVoice(context: BaseAudioContext, params: EngineAudioParams): EngineVoice {
  // Everything meets here and is squeezed on the way out, so the bus can run
  // loud enough to be heard on a phone without the peaks clipping.
  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = params.compressor.thresholdDb
  compressor.knee.value = params.compressor.kneeDb
  compressor.ratio.value = params.compressor.ratio
  compressor.attack.value = params.compressor.attack
  compressor.release.value = params.compressor.release
  compressor.connect(context.destination)

  const master = context.createGain()
  master.gain.value = 0
  master.connect(compressor)

  const level = context.createGain()
  level.gain.value = 0
  level.connect(master)

  const lowpass = context.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = params.lowpass.baseHz
  lowpass.Q.value = params.lowpass.q
  lowpass.connect(level)

  // The harmonic stack. Sawtooths and squares, never sines: a pure tone is a
  // drone, and what makes an engine an engine is the edge on the waveform.
  const oscillators = params.harmonics.map((harmonic) => {
    const oscillator = context.createOscillator()
    oscillator.type = harmonic.wave
    oscillator.frequency.value = MIN_OSCILLATOR_HZ
    oscillator.detune.value = harmonic.detune
    const gain = context.createGain()
    gain.gain.value = harmonic.gain
    oscillator.connect(gain)
    gain.connect(lowpass)
    oscillator.start()
    return oscillator
  })

  // One loop of noise feeds both layers: the band-passed body under the
  // harmonics, and the bright hiss of a tyre giving up.
  const noise = context.createBufferSource()
  noise.buffer = createNoiseBuffer(context)
  noise.loop = true

  const noiseBand = context.createBiquadFilter()
  noiseBand.type = 'bandpass'
  noiseBand.frequency.value = params.noise.minHz
  noiseBand.Q.value = params.noise.q
  const noiseGain = context.createGain()
  noiseGain.gain.value = 0
  noise.connect(noiseBand)
  noiseBand.connect(noiseGain)
  noiseGain.connect(lowpass)

  const spinBand = context.createBiquadFilter()
  spinBand.type = 'bandpass'
  spinBand.frequency.value = params.spin.centreHz
  spinBand.Q.value = params.spin.q
  const spinGain = context.createGain()
  spinGain.gain.value = 0
  noise.connect(spinBand)
  spinBand.connect(spinGain)
  // Straight to the master: wheelspin is heard over the engine, not through
  // the same low-pass that is busy muffling it.
  spinGain.connect(master)
  noise.start()

  // Slipping clutch: a slow beat added onto the engine's own level. The depth
  // is a signal into the parameter, so it rides on top of the ramps.
  const beat = context.createOscillator()
  beat.type = 'sine'
  beat.frequency.value = params.clutch.minHz
  const beatDepth = context.createGain()
  beatDepth.gain.value = 0
  beat.connect(beatDepth)
  beatDepth.connect(level.gain)
  beat.start()

  return {
    context,
    compressor,
    master,
    level,
    lowpass,
    oscillators,
    noiseBand,
    noiseGain,
    spinBand,
    spinGain,
    beat,
    beatDepth,
  }
}

function createNoiseBuffer(context: BaseAudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * NOISE_SECONDS)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1
  return buffer
}

/** Every parameter change goes through here. There is no other way to set one. */
function ramp(param: AudioParam, value: number, timeConstant: number, now: number): void {
  param.setTargetAtTime(value, now, timeConstant)
}

/**
 * Reads one frame of powertrain state and moves the sound towards it.
 *
 * Safe to call before the device exists: the phase machine still runs, so an
 * engine that dies before the first gesture is in the right state afterwards.
 */
export function updateEngineAudio(
  audio: EngineAudio,
  powertrain: Readonly<PowertrainState>,
  deltaRpm: number,
  throttle: number,
  dt: number,
): void {
  const { params, engine } = audio

  // --- Phase --------------------------------------------------------------
  // The powertrain drops the rpm to zero the instant it stalls, so the death
  // is the sound's own business: it keeps the speed the engine last had and
  // runs it down itself.
  const cranking = !powertrain.running && powertrain.rpm > 0
  if (powertrain.running) {
    audio.phase = 'running'
    audio.dying = 0
  } else if (cranking) {
    audio.phase = 'cranking'
    audio.dying = 0
  } else if (audio.phase === 'running' || audio.phase === 'cranking') {
    audio.phase = 'dying'
    audio.dying = params.stall.duration
    audio.dyingRpm = Math.max(audio.lastRpm, engine.idleRpm * 0.4)
  } else if (audio.phase === 'dying') {
    audio.dying = Math.max(0, audio.dying - dt)
    if (audio.dying === 0) audio.phase = 'silent'
  }
  if (audio.phase === 'running' || audio.phase === 'cranking') audio.lastRpm = powertrain.rpm

  const voice = audio.voice
  if (voice === null) {
    audio.readout.state = 'sem contexto'
    audio.readout.masterGain = 0
    audio.readout.fundamental = 0
    return
  }

  // --- What the engine is doing this frame --------------------------------
  const load = clamp(throttle, 0, 1)
  let rpm = powertrain.rpm
  let level: number

  if (audio.phase === 'silent') {
    rpm = audio.lastRpm
    level = 0
  } else if (audio.phase === 'dying') {
    // A fall with one cough in it. Both curves start exactly where the running
    // engine left off, so the death begins without a step of any kind.
    const progress = 1 - audio.dying / params.stall.duration
    const fall = Math.pow(Math.max(0, 1 - progress), 1.4)
    const cough = Math.exp(-Math.pow((progress - params.stall.coughAt) / params.stall.coughWidth, 2))
    rpm = audio.dyingRpm * (fall + cough * params.stall.coughRpm)
    level = params.gain.idle * (fall + cough * params.stall.coughGain)
  } else {
    const revs = clamp(rpm / engine.maxRpm, 0, 1)
    level = params.gain.idle + params.gain.rpmSpan * revs + params.gain.loadSpan * load
    // Turning over on the starter fades in with the rpm instead of arriving
    // at full voice on the first frame.
    if (audio.phase === 'cranking') level *= clamp(rpm / engine.idleRpm, 0, 1)
    // The gearbox cutting torque is heard as the level dipping; the drop in
    // pitch comes free, because the rpm itself falls.
    if (powertrain.shiftCut > 0) level *= 1 - params.shift.gainDrop
  }

  // --- Clutch slip --------------------------------------------------------
  // Only while the plates are actually rubbing: a locked clutch carries a
  // standing difference of its own, and that is not a slipping clutch.
  const rubbing = !powertrain.locked && audio.phase === 'running'
  const slipSpan = Math.max(1, params.clutch.fullDeltaRpm - params.clutch.minDeltaRpm)
  const slip = rubbing
    ? clamp((Math.abs(deltaRpm) - params.clutch.minDeltaRpm) / slipSpan, 0, 1) *
      clamp(powertrain.engagement / params.clutch.biteReference, 0, 1)
    : 0

  // --- Write it all onto the graph ----------------------------------------
  const now = voice.context.currentTime
  const smoothing = params.smoothing
  const fundamental = (rpm / 60) * (params.cylinders / 2)

  for (let i = 0; i < voice.oscillators.length; i++) {
    const harmonic = params.harmonics[i]
    const frequency = Math.max(MIN_OSCILLATOR_HZ, fundamental * harmonic.ratio)
    ramp(voice.oscillators[i].frequency, frequency, smoothing.frequency, now)
  }

  // Brightness rises with load, but never falls so far that the tone itself is
  // filtered away -- and drops again while the clutch is slipping, which is
  // most of what makes a slipping clutch recognisable.
  const opened = params.lowpass.baseHz + params.lowpass.loadHz * load
  const floor = fundamental * params.lowpass.minHarmonic
  const cutoff = clamp(
    Math.max(opened, floor) * lerp(1, params.clutch.muffle, slip),
    MIN_FILTER_HZ,
    params.lowpass.maxHz,
  )
  ramp(voice.lowpass.frequency, cutoff, smoothing.filter, now)

  ramp(
    voice.noiseBand.frequency,
    clamp(fundamental * params.noise.centreRatio, params.noise.minHz, params.noise.maxHz),
    smoothing.filter,
    now,
  )
  ramp(voice.noiseGain.gain, level > 0 ? params.noise.gain : 0, smoothing.gain, now)

  const spinning = powertrain.wheelspin && audio.phase === 'running'
  const spin = spinning
    ? clamp(Math.abs(powertrain.wheelSlip) / params.spin.slipReference, 0, 1) * params.spin.gain
    : 0
  ramp(voice.spinGain.gain, spin, smoothing.gain, now)

  ramp(voice.level.gain, level, smoothing.gain, now)
  ramp(voice.beatDepth.gain, level * params.clutch.depth * slip, smoothing.gain, now)
  ramp(
    voice.beat.frequency,
    clamp(Math.abs(deltaRpm) / 60, params.clutch.minHz, params.clutch.maxHz),
    smoothing.filter,
    now,
  )

  const master =
    audio.muted || !audio.audible ? 0 : params.masterGain * clamp(audio.volume, 0, 1)
  ramp(voice.master.gain, master, smoothing.gain, now)

  audio.readout.state = describeContextState(voice.context.state)
  audio.readout.masterGain = master
  audio.readout.fundamental = fundamental
}

/** Portuguese for the overlay, and one word for each way audio can be silent. */
function describeContextState(state: AudioContextState): string {
  switch (state) {
    case 'running':
      return 'rodando'
    case 'suspended':
      return 'suspenso'
    case 'closed':
      return 'fechado'
    default:
      return String(state)
  }
}
