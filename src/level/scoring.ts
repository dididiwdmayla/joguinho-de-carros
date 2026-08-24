/**
 * What a finished manoeuvre was worth.
 *
 * Two things come out of a run, and keeping them apart is what this file is
 * for.
 *
 * The **criteria** are the four questions a driving examiner would ask: was it
 * done in time, was the car marked, did the engine die, is it in the bay. Each
 * one is a value against a stated limit, and each one passes or it does not.
 * Meeting all four is three stars -- always, and by definition rather than by
 * arithmetic. That is the rule the old scoring could not keep: the precision
 * penalty reached its full weight at exactly the tolerance the bay validates
 * at, so a park the game had just accepted as good enough cost up to
 * forty-five points on its own, and a flawless run came back with two stars
 * and nothing on screen to say why.
 *
 * The **points** are the finer grade underneath, still built from the weights
 * and references the level file declares, and still able to award a third star
 * to a run that missed a criterion narrowly. They decide the second star from
 * the first.
 *
 * Every threshold shown to the player is one the game already uses for
 * something: the target time the clock is scored against, the centre and angle
 * tolerances the bay validates at. Nothing here invents a stricter standard
 * than the one the run was already judged by.
 */
import { clamp, radToDeg } from '../core/math'
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

export type CriterionId = 'tempo' | 'dano' | 'motor' | 'precisao'

/**
 * One of the four, as the completion screen shows it.
 *
 * The reading and the limit are formatted together, always as "what happened /
 * what was allowed", because either number alone says nothing: 42 cm from the
 * middle of a bay is excellent in one level and a fail in another. A criterion
 * knows its own units -- seconds, metres per second, centimetres, degrees --
 * and nothing downstream should have to.
 */
export interface ScoreCriterion {
  readonly id: CriterionId
  readonly label: string
  /** Reading and limit on one line, e.g. "12.3 / 45 s". */
  readonly detail: string
  readonly passed: boolean
}

export interface ScoreBreakdown {
  /** 0..100. */
  readonly points: number
  /** 1..3. */
  readonly stars: number
  /** The four questions, in the order they are shown. */
  readonly criteria: readonly ScoreCriterion[]
  /** What each part cost, for anything that wants the arithmetic. */
  readonly timePenalty: number
  readonly damagePenalty: number
  readonly stallPenalty: number
  readonly precisionPenalty: number
}

/**
 * Impact below this is not damage.
 *
 * The collision log already ignores anything gentler -- a car resting against
 * a wall is re-separated by a hair every step -- so this is the same floor,
 * stated where the scoring can be read. Rolling to a stop against a parked car
 * at walking pace leaves the paint on both.
 */
const DAMAGE_FLOOR = 0.15

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

  const criteria = criteriaFor(summary, params)
  const clean = criteria.every((criterion) => criterion.passed)

  return {
    points,
    // Three stars for a clean run, whatever the arithmetic makes of it, and
    // three stars for a high enough score, whichever criterion it missed. The
    // second star is the score's alone.
    stars: clean || points >= score.threeStars ? 3 : points >= score.twoStars ? 2 : 1,
    criteria,
    timePenalty,
    damagePenalty,
    stallPenalty,
    precisionPenalty: distancePenalty + anglePenalty,
  }
}

/**
 * The four, measured.
 *
 * Precision is one criterion and two numbers, because a bay accepts a car on
 * both: how far the centre sits from the bay's, and how far off its axis. It
 * passes on the same two tolerances the bay validated against -- so a run that
 * finished is a run that met it, which is the point. The row is there to show
 * how much of the tolerance was used, not to take a star back.
 */
function criteriaFor(summary: RunSummary, params: LevelParams): ScoreCriterion[] {
  const distanceOk = summary.distance <= params.centerTolerance
  const angleOk = summary.angleError <= params.angleTolerance

  return [
    {
      id: 'tempo',
      label: 'TEMPO',
      detail: `${summary.time.toFixed(1)} / ${params.targetTime.toFixed(0)} s`,
      passed: summary.time <= params.targetTime,
    },
    {
      id: 'dano',
      label: 'DANO',
      detail: `${summary.damage.toFixed(2)} / ${DAMAGE_FLOOR.toFixed(2)}`,
      passed: summary.damage <= DAMAGE_FLOOR,
    },
    {
      id: 'motor',
      label: 'MOTOR MORTO',
      detail: `${summary.stalls} / 0`,
      passed: summary.stalls === 0,
    },
    {
      id: 'precisao',
      label: 'PRECISAO',
      detail:
        `${(summary.distance * 100).toFixed(0)}/${(params.centerTolerance * 100).toFixed(0)} cm  ` +
        `${radToDeg(summary.angleError).toFixed(1)}/${radToDeg(params.angleTolerance).toFixed(0)} gr`,
      passed: distanceOk && angleOk,
    },
  ]
}
