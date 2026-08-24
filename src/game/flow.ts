/**
 * The state machine the whole game runs through.
 *
 * Six states, and every change between them happens in this file. Nothing
 * anywhere else may set a phase: the frame loop asks for a transition and the
 * functions here decide whether it makes sense, which is the only way a state
 * machine spread across a codebase stays a state machine at all.
 *
 *   menu  --escolhe-->  carregando  --pronto-->  jogando
 *   jogando  <--continua-->  pausado
 *   jogando  --vaga validada-->  concluido
 *   jogando  --tempo ou dano-->  falhou
 *   qualquer um  --sair-->  menu
 *
 * The clock only runs in `jogando`. That is what makes pausing free and what
 * stops a run being scored on time spent in a settings menu.
 */
import { createDamageLog, resetDamageLog, type DamageLog } from '../collision/vehicleCollision'
import type { LevelDefinition } from '../level/levelSchema'
import type { LevelRuntime } from '../level/levelRuntime'
import { createParkingState, resetParkingState, type ParkingState } from '../level/parking'
import { scoreRun, type RunSummary, type ScoreBreakdown } from '../level/scoring'
import { loadProgress, recordRun, type LevelRecord, type Progress } from './progress'

export type Phase = 'menu' | 'carregando' | 'jogando' | 'pausado' | 'concluido' | 'falhou'

/** Why a run was lost. Both are switched off by a level that writes null. */
export type FailureReason = 'tempo' | 'dano'

/** Everything one attempt at a level accumulates. */
export interface RunState {
  /** Time on the clock [s]. */
  time: number
  /** How many times the engine died. */
  stalls: number
  /** Whether it was dead last frame, so a death is counted once. */
  wasStalled: boolean
  readonly damage: DamageLog
  readonly parking: ParkingState
}

export interface RunResult {
  readonly levelId: string
  readonly summary: RunSummary
  readonly score: ScoreBreakdown
  readonly record: LevelRecord
  /** True when this run beat whatever was stored for the level. */
  readonly best: boolean
}

export interface FlowState {
  phase: Phase
  /** Index into the level catalog of whatever is loaded or being loaded. */
  levelIndex: number
  /** Built when the level loads; kept while it is paused or finished. */
  runtime: LevelRuntime | null
  readonly run: RunState
  /** Filled when a run is won, cleared when the next one starts. */
  result: RunResult | null
  failure: FailureReason | null
  progress: Progress
  /** Bumped whenever anything a screen shows changes. */
  revision: number
}

export function createFlowState(): FlowState {
  return {
    phase: 'menu',
    levelIndex: 0,
    runtime: null,
    run: {
      time: 0,
      stalls: 0,
      wasStalled: false,
      damage: createDamageLog(),
      parking: createParkingState(),
    },
    result: null,
    failure: null,
    progress: loadProgress(),
    revision: 0,
  }
}

/** Wipes the run so the next attempt starts from nothing. */
export function resetRun(flow: FlowState): void {
  flow.run.time = 0
  flow.run.stalls = 0
  flow.run.wasStalled = false
  resetDamageLog(flow.run.damage)
  resetParkingState(flow.run.parking)
  flow.result = null
  flow.failure = null
}

/** Asks for a level. The loop notices `carregando` and builds it. */
export function chooseLevel(flow: FlowState, index: number): void {
  flow.levelIndex = index
  flow.runtime = null
  flow.phase = 'carregando'
  resetRun(flow)
  flow.revision++
}

/** Called once the runtime exists and the car is standing on the spawn. */
export function levelReady(flow: FlowState, runtime: LevelRuntime): void {
  flow.runtime = runtime
  flow.phase = 'jogando'
  resetRun(flow)
  flow.revision++
}

export function pauseRun(flow: FlowState): void {
  if (flow.phase !== 'jogando') return
  flow.phase = 'pausado'
  flow.revision++
}

export function resumeRun(flow: FlowState): void {
  if (flow.phase !== 'pausado') return
  flow.phase = 'jogando'
  flow.revision++
}

/** Back to the level list, whatever was happening. */
export function leaveToMenu(flow: FlowState): void {
  flow.phase = 'menu'
  flow.runtime = null
  resetRun(flow)
  flow.revision++
}

export function failRun(flow: FlowState, reason: FailureReason): void {
  if (flow.phase !== 'jogando') return
  flow.phase = 'falhou'
  flow.failure = reason
  flow.revision++
}

/**
 * Scores the run, files it if it is the best one, and shows the result. The
 * distance and the angle come from the parking check of the moment the bay was
 * won, which is the pose the player actually left the car in.
 */
export function completeRun(flow: FlowState, level: LevelDefinition): void {
  if (flow.phase !== 'jogando') return
  const { run } = flow
  const summary: RunSummary = {
    time: run.time,
    damage: run.damage.total,
    stalls: run.stalls,
    distance: run.parking.check.distance,
    angleError: run.parking.check.angleError,
  }
  const score = scoreRun(summary, level.params)
  const record: LevelRecord = {
    stars: score.stars,
    points: score.points,
    time: summary.time,
    damage: summary.damage,
  }
  const filed = recordRun(flow.progress, level.id, record)
  flow.progress = filed.progress
  flow.result = { levelId: level.id, summary, score, record, best: filed.best }
  flow.phase = 'concluido'
  flow.revision++
}

/**
 * Advances the clock and answers the two ways a run can be lost. Called once
 * per fixed step while playing, never otherwise.
 */
export function advanceRun(
  flow: FlowState,
  level: LevelDefinition,
  stalled: boolean,
  dt: number,
): void {
  if (flow.phase !== 'jogando') return
  const { run } = flow
  run.time += dt

  // A death is the edge, not the state: an engine left dead for ten seconds
  // died once.
  if (stalled && !run.wasStalled) run.stalls++
  run.wasStalled = stalled

  const { timeLimit, damageLimit } = level.params
  if (timeLimit !== null && run.time >= timeLimit) {
    failRun(flow, 'tempo')
    return
  }
  if (damageLimit !== null && run.damage.total >= damageLimit) {
    failRun(flow, 'dano')
  }
}

/** Whether the world should be simulated this frame. */
export function isDriving(phase: Phase): boolean {
  return phase === 'jogando'
}

/** Whether a level's scene is on screen at all, driving or not. */
export function hasScene(phase: Phase): boolean {
  return phase !== 'menu' && phase !== 'carregando'
}
