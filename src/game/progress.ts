/**
 * The best run of each level, kept between sessions.
 *
 * One key, one object, the same defensive read the other stored settings use:
 * storage can be full, forbidden or hold something from an older version of
 * the game, and none of those may cost more than a forgotten record.
 *
 * "Best" is stars first, then points, then the clock. Stars are what the level
 * list shows, so a run that earned a third star is the better run even if a
 * later one was quicker and stayed on two.
 */
import { clamp } from '../core/math'

export interface LevelRecord {
  /** 1..3. */
  readonly stars: number
  readonly points: number
  /** Time of the run [s]. */
  readonly time: number
  /** Accumulated impact of the run [m/s]. */
  readonly damage: number
}

export type Progress = Record<string, LevelRecord>

const STORAGE_KEY = 'joguinho.progresso.v1'

export function loadProgress(): Progress {
  // The flow is exercised by the level tests, which run with no browser
  // around them and therefore with nowhere to keep a record.
  if (typeof window === 'undefined') return {}
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return {}
  }
  if (raw === null) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}

  const progress: Progress = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const record = readRecord(value)
    if (record !== null) progress[id] = record
  }
  return progress
}

function readRecord(value: unknown): LevelRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const source = value as Record<string, unknown>
  const stars = source['stars']
  const points = source['points']
  const time = source['time']
  const damage = source['damage']
  if (
    typeof stars !== 'number' ||
    typeof points !== 'number' ||
    typeof time !== 'number' ||
    typeof damage !== 'number' ||
    !Number.isFinite(stars) ||
    !Number.isFinite(points) ||
    !Number.isFinite(time) ||
    !Number.isFinite(damage)
  ) {
    return null
  }
  return {
    stars: clamp(Math.round(stars), 1, 3),
    points: clamp(points, 0, 100),
    time: Math.max(0, time),
    damage: Math.max(0, damage),
  }
}

/** True when `candidate` deserves the slot `existing` is in. */
export function isBetter(candidate: LevelRecord, existing: LevelRecord | undefined): boolean {
  if (existing === undefined) return true
  if (candidate.stars !== existing.stars) return candidate.stars > existing.stars
  if (candidate.points !== existing.points) return candidate.points > existing.points
  return candidate.time < existing.time
}

/**
 * Files a finished run and returns the progress that should be shown from now
 * on, along with whether this run was the new best. The stored copy is written
 * only when it changed, so replaying a level nobody beat costs no storage.
 */
export function recordRun(
  progress: Progress,
  levelId: string,
  record: LevelRecord,
): { progress: Progress; best: boolean } {
  if (!isBetter(record, progress[levelId])) return { progress, best: false }
  const updated: Progress = { ...progress, [levelId]: record }
  saveProgress(updated)
  return { progress: updated, best: true }
}

export function saveProgress(progress: Progress): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch (error: unknown) {
    console.warn('[joguinho] nao foi possivel salvar o progresso', error)
  }
}
