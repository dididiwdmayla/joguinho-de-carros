/**
 * What happens when the car hits something.
 *
 * The response is inelastic on purpose. A car that bounces off a parked one is
 * a pinball, and a game about placing a car within centimetres cannot afford
 * to have the scenery throw it back: the impulse here takes away exactly the
 * speed that was going into the obstacle and no more, so a hit stops the car
 * dead against what it hit. What survives is the speed along the surface,
 * which is why a wall taken at a shallow angle scrapes and slides instead of
 * catching -- the same single impulse produces both, without a special case
 * for either.
 *
 * Rotation comes out of the same impulse, applied at the point the two boxes
 * are actually pressing against each other. Clipping a bollard with a front
 * corner therefore swings the nose, and running square into a wall does not.
 *
 * Every contact reports how fast the two were closing along the normal. That
 * number is the impact, and the sum of it over a run is the damage.
 */
import { clamp } from '../core/math'
import { collideObb, createContact, obbExtentX, obbExtentY, setObbPose, type Obb } from './obb'
import { queryGrid } from './grid'
import { boundsOf, type CollisionWorld } from './world'

/** The moving box, and the two numbers the impulse needs. */
export interface VehicleCollider {
  readonly box: Obb
  /** Mass [kg]. */
  readonly mass: number
  /** Yaw moment of inertia [kg*m^2]. */
  readonly inertia: number
  /**
   * Bounce, 0..1. Kept near zero by design: this is not a switch to be turned
   * up, it is here so a level can add the faintest give to a rubber cone.
   */
  readonly restitution: number
  /** Coulomb friction along the contact, which is what a scrape costs. */
  readonly friction: number
}

/** Where a run's damage is collected. Reset when the run starts. */
export interface DamageLog {
  /** Sum of every impact this run [m/s]. */
  total: number
  /** How many separate hits were counted. */
  count: number
  /** Hardest single impact [m/s]. */
  worst: number
  /** Impact of the most recent step [m/s], 0 on a step that touched nothing. */
  latest: number
  /**
   * Which bodies the car was already against last step, and which it is
   * against this one.
   *
   * This is what tells a hit from a lean. A car held against a wall with the
   * throttle down closes on it by a hair every step, and counting each of
   * those as a fresh impact would write the car off in three seconds of doing
   * something that in life costs nothing but embarrassment. A body already
   * touched last step is not hit again until it has been let go of.
   */
  touched: Set<number>
  previous: Set<number>
}

export function createDamageLog(): DamageLog {
  return {
    total: 0,
    count: 0,
    worst: 0,
    latest: 0,
    touched: new Set<number>(),
    previous: new Set<number>(),
  }
}

export function resetDamageLog(log: DamageLog): void {
  log.total = 0
  log.count = 0
  log.worst = 0
  log.latest = 0
  log.touched.clear()
  log.previous.clear()
}

/** The state the response reads and writes: a pose and a world velocity. */
export interface ColliderMotion {
  x: number
  y: number
  /** World-frame velocity [m/s]. */
  vx: number
  vy: number
  /** Heading and heading rate [rad], [rad/s]. */
  yaw: number
  yawRate: number
}

/**
 * Closing speed under which a contact is not worth logging [m/s]. A car
 * resting against a wall is re-separated by a hair every step, and counting
 * those as damage would have a parked car slowly writing itself off.
 */
const IMPACT_FLOOR = 0.15

/**
 * Overlap left in place [m]. Pushing a contact to exactly zero makes it
 * separate and re-touch on alternate steps, which chatters; leaving a tenth of
 * a millimetre keeps it resting quietly.
 */
const PENETRATION_SLOP = 0.0005

/** Most a single step may push the car out by [m], so nothing ever teleports. */
const MAX_CORRECTION = 0.25

/**
 * Passes over the contacts. Two is enough for the corner where a wall meets a
 * parked car: the first pushes the car off one, the second off the other,
 * and a third would only be re-proving that it is now clear of both.
 */
const ITERATIONS = 2

const contact = createContact()

/**
 * Resolves the car against everything near it and returns the hardest impact
 * of the step [m/s]. Mutates both the collider's pose and `motion`.
 */
export function resolveVehicleCollisions(
  world: CollisionWorld,
  collider: VehicleCollider,
  motion: ColliderMotion,
  log: DamageLog,
): number {
  log.latest = 0
  if (world.bodies.length === 0) {
    log.previous.clear()
    return 0
  }

  log.touched.clear()
  let hardest = 0
  for (let pass = 0; pass < ITERATIONS; pass++) {
    setObbPose(collider.box, motion.x, motion.y, motion.yaw)
    const bounds = boundsOf(collider.box)
    const count = queryGrid(
      world.grid,
      bounds.minX,
      bounds.minY,
      bounds.maxX,
      bounds.maxY,
      world.candidates,
    )
    let touched = false

    for (let i = 0; i < count; i++) {
      const index = world.candidates[i]
      const body = world.bodies[index]
      // The cheap test first: two boxes whose upright shadows miss cannot
      // overlap, and most candidates in a cell are exactly that.
      if (!nearEnough(collider.box, body.box)) continue
      if (!collideObb(collider.box, body.box, contact)) continue

      touched = true
      const impact = applyContact(collider, motion, contact)
      if (impact > hardest) hardest = impact
      // Every fresh contact is worth what it closed at. A second pass over the
      // same body has almost nothing left to close -- the impulse above took
      // it -- and a body already leaned on last step is not a new hit at all.
      const fresh = !log.previous.has(index) && !log.touched.has(index)
      log.touched.add(index)
      if (fresh && impact >= IMPACT_FLOOR) {
        log.total += impact
        log.count++
        log.latest = Math.max(log.latest, impact)
        if (impact > log.worst) log.worst = impact
      }
      // The pose moved, so the next body of this pass is tested against where
      // the car is now rather than where it started.
      setObbPose(collider.box, motion.x, motion.y, motion.yaw)
    }

    if (!touched) break
  }

  // This step's contacts become next step's history, without allocating: the
  // two sets are swapped and the older one is cleared on the next call.
  const carried = log.previous
  log.previous = log.touched
  log.touched = carried
  return hardest
}

/** Upright bounding-box rejection, before the four axes of the real test. */
function nearEnough(a: Obb, b: Obb): boolean {
  return (
    Math.abs(a.x - b.x) <= obbExtentX(a) + obbExtentX(b) &&
    Math.abs(a.y - b.y) <= obbExtentY(a) + obbExtentY(b)
  )
}

/**
 * One contact: push the boxes apart, then take away the speed that was going
 * into the obstacle. Returns the closing speed along the normal [m/s], which
 * is the impact this contact is worth.
 */
function applyContact(
  collider: VehicleCollider,
  motion: ColliderMotion,
  hit: { depth: number; nx: number; ny: number; px: number; py: number },
): number {
  // --- separation ---------------------------------------------------------
  // Static bodies never move, so the whole of the overlap is taken out of the
  // car's position. Capped, because a car spawned inside a wall must walk out
  // of it over a few steps rather than be flung across the lot in one.
  const push = Math.min(Math.max(0, hit.depth - PENETRATION_SLOP), MAX_CORRECTION)
  motion.x += hit.nx * push
  motion.y += hit.ny * push

  // --- the impulse --------------------------------------------------------
  const rx = hit.px - motion.x
  const ry = hit.py - motion.y
  // Velocity of the contact point: the body's own velocity plus the spin
  // about its centre. In two dimensions the cross product of the yaw rate
  // with the arm is simply (-w*ry, +w*rx).
  const contactVx = motion.vx - motion.yawRate * ry
  const contactVy = motion.vy + motion.yawRate * rx
  const closing = contactVx * hit.nx + contactVy * hit.ny
  // Already leaving: nothing to take away, and no impact to report.
  if (closing >= 0) return 0

  const armNormal = rx * hit.ny - ry * hit.nx
  const normalMass = 1 / collider.mass + (armNormal * armNormal) / collider.inertia
  const impulse = (-(1 + collider.restitution) * closing) / normalMass
  applyImpulse(collider, motion, rx, ry, hit.nx * impulse, hit.ny * impulse)

  // --- friction along the surface -----------------------------------------
  // What is left of the contact point's velocity once the normal part is
  // gone. Taking a fraction of it is what makes a scrape cost something
  // without ever stopping the car dead against a wall it is sliding along.
  const tangentX = -hit.ny
  const tangentY = hit.nx
  const sliding =
    (motion.vx - motion.yawRate * ry) * tangentX + (motion.vy + motion.yawRate * rx) * tangentY
  const armTangent = rx * tangentY - ry * tangentX
  const tangentMass = 1 / collider.mass + (armTangent * armTangent) / collider.inertia
  const wanted = -sliding / tangentMass
  const limit = collider.friction * impulse
  const tangentImpulse = clamp(wanted, -limit, limit)
  applyImpulse(collider, motion, rx, ry, tangentX * tangentImpulse, tangentY * tangentImpulse)

  return -closing
}

function applyImpulse(
  collider: VehicleCollider,
  motion: ColliderMotion,
  rx: number,
  ry: number,
  jx: number,
  jy: number,
): void {
  motion.vx += jx / collider.mass
  motion.vy += jy / collider.mass
  motion.yawRate += (rx * jy - ry * jx) / collider.inertia
}
