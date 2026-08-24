/**
 * What a finished manoeuvre was worth.
 *
 * Four things cost points: the clock, the paintwork, the engine, and how
 * squarely the car ended up in the bay. Every weight and both star thresholds
 * come out of the level file, so the balance of a level is something to be
 * edited rather than something to be argued with in code.
 *
 * Each penalty is measured against a reference the level already has to
 * declare -- the target time, the centre tolerance, the angle tolerance -- and
 * is worth its full weight when the run is a whole reference away. Parking at
 * the very edge of the tolerance therefore costs the entire precision weight,
 * and parking dead centre costs none of it.
 */
import { clamp } from '../core/math'
import type { LevelParams } from './levelSchema'

/** Everything a run accumulated, handed over when the bay is won. */
export interface RunSummary {
  /** Wall clock of the run [s]. */
  readonly time: number
  /** Sum of every impact [m/s]. */
  readonly damage: number
  /** How many times the engine died. */
  readonly stalls: number
  /** Distance from the car's centre to the bay's, at the end [m]. */
  readonly distance: number
  /** How far off the bay's axis the car finished [rad]. */
  readonly angleError: number
}

export interface ScoreBreakdown {
  /** 0..100. */
  readonly points: number
  /** 1..3. */
  readonly stars: number
  /** What each part cost, for the completion screen to show. */
  readonly timePenalty: number
  readonly damagePenalty: number
  readonly stallPenalty: number
  readonly precisionPenalty: number
}

export function scoreRun(summary: RunSummary, params: LevelParams): ScoreBreakdown {
  const score = params.score

  // Being quicker than the target is free rather than worth points: this is a
  // parking game, and paying for speed would teach exactly the wrong thing.
  const overtime = clamp(summary.time / params.targetTime - 1, 0, 1)
  const timePenalty = score.timeWeight * overtime

  const damagePenalty = score.damageWeight * clamp(summary.damage / score.damageReference, 0, 1)
  const stallPenalty = score.stallWeight * clamp(summary.stalls / score.stallReference, 0, 1)

  const distancePenalty =
    score.distanceWeight * clamp(summary.distance / params.centerTolerance, 0, 1)
  const anglePenalty = score.angleWeight * clamp(summary.angleError / params.angleTolerance, 0, 1)

  const points = clamp(
    100 - timePenalty - damagePenalty - stallPenalty - distancePenalty - anglePenalty,
    0,
    100,
  )

  return {
    points,
    stars: points >= score.threeStars ? 3 : points >= score.twoStars ? 2 : 1,
    timePenalty,
    damagePenalty,
    stallPenalty,
    precisionPenalty: distancePenalty + anglePenalty,
  }
}
