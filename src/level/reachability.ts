/**
 * Can the car still be got into the bay?
 *
 * A level is a promise, and tightening one is a good way to break it. A bay
 * that admits the car standing still is not the same as a bay the car can be
 * driven into: the manoeuvre needs room the parked pose does not, and the
 * difference between "snug" and "impossible" is a few centimetres nobody can
 * see in a level file.
 *
 * So the question is answered rather than estimated. This is an A* over the
 * car's own low-speed kinematics -- the same bicycle model the physics falls
 * back to at a crawl, at the same steering lock, against the same collision
 * world the game runs on -- searched from the parked pose outwards until it
 * arrives at the spawn. Outwards because a car's paths run both ways: every
 * arc it can drive forwards it can drive in reverse, so a route out of the bay
 * is a route into it, and starting at the tight end solves the hard part
 * first.
 *
 * What it proves is geometric, which is what a bay's difficulty is made of.
 * The gearbox is not part of the question -- all three of them deliver the
 * same arcs at a walking pace -- and neither is the player's patience: the
 * search will happily shuffle back and forth twenty times, and reports how
 * many times it had to, which is the honest measure of how tight a bay is.
 */
import { collideObb, createContact, createObb, setObbPose, type Obb } from '../collision/obb'
import { queryGrid } from '../collision/grid'
import { boundsOf } from '../collision/world'
import type { CarParams } from '../vehicle/carParams'
import { createPowertrainState, NEUTRAL_GEAR } from '../vehicle/powertrain'
import { createVehicleState } from '../vehicle/vehicleState'
import type { LevelRuntime } from './levelRuntime'
import type { LevelDefinition } from './levelSchema'
import { checkParking, createParkingCheck } from './parking'

/** The car's box, which is the manifest's metres and not the car file's. */
export interface ColliderSize {
  readonly length: number
  readonly width: number
}

export interface ReachResult {
  /** Whether a route between the spawn and a valid parked pose exists. */
  readonly reached: boolean
  /** Poses taken off the queue, for a sense of what the search cost. */
  readonly expanded: number
  /** Arcs in the route found, or 0 when there was none. */
  readonly moves: number
  /**
   * How many times the route changes between forward and reverse. The number
   * a driver would call "shuffles", and the one that says whether a bay is
   * tight or merely small.
   */
  readonly reversals: number
  /** Closest the search got to the spawn [m]; 0 or near it when it arrived. */
  readonly closest: number
}

/** Grid the search dedupes poses on: 20 cm, and four degrees. */
const CELL = 0.25
const YAW_BINS = 72

/** One arc: 36 cm, checked at three points along it. */
const STEP = 0.12
const SUBSTEPS = 3

/** Steering positions offered, as fractions of full lock, both ways. */
const STEERS: readonly number[] = [-1, -0.55, 0, 0.55, 1]

/** Close enough to the spawn to call it the same place [m] and [rad]. */
const SPAWN_REACH = 1.2
const SPAWN_HEADING = Math.PI / 6

/**
 * Poses the search may expand before giving up. Generous: every level in the
 * game is solved inside a fraction of it, and a run that needs more than this
 * is a level nobody would want to play anyway.
 */
const BUDGET = 400_000

const TAU = Math.PI * 2
const contact = createContact()

export function reachTargetBay(
  runtime: LevelRuntime,
  definition: LevelDefinition,
  car: CarParams,
  size: ColliderSize,
): ReachResult {
  const box = createObb(0, 0, size.length, size.width, 0)
  const grid = poseGrid(definition)

  // --- where the search is trying to get to -------------------------------
  const spawn = definition.spawn
  const atSpawn = (x: number, y: number, yaw: number): boolean =>
    Math.hypot(x - spawn.x, y - spawn.y) <= SPAWN_REACH &&
    Math.abs(shortestAngle(yaw - spawn.angle)) <= SPAWN_HEADING

  // --- and where it starts ------------------------------------------------
  const starts = parkedPoses(runtime, definition, car, box)
  if (starts.length === 0) {
    return { reached: false, expanded: 0, moves: 0, reversals: 0, closest: Infinity }
  }

  const open = new Heap()
  const seen = new Uint8Array(grid.columns * grid.rows * YAW_BINS)
  // Three numbers a pose, plus where it came from and which way it was going,
  // so the route can be walked back and its shuffles counted.
  const poseX: number[] = []
  const poseY: number[] = []
  const poseYaw: number[] = []
  const parent: number[] = []
  const heading: number[] = []
  const cost: number[] = []

  const admit = (
    x: number,
    y: number,
    yaw: number,
    from: number,
    direction: number,
    spent: number,
  ): number => {
    const index = grid.key(x, y, yaw)
    if (index < 0 || seen[index] === 1) return -1
    seen[index] = 1
    const node = poseX.length
    poseX.push(x)
    poseY.push(y)
    poseYaw.push(yaw)
    parent.push(from)
    heading.push(direction)
    cost.push(spent)
    open.push(node, spent + Math.hypot(x - spawn.x, y - spawn.y))
    return node
  }

  for (const start of starts) admit(start.x, start.y, start.yaw, -1, 0, 0)

  const wheelbase = car.wheelbase
  let expanded = 0
  let closest = Infinity

  while (open.size > 0 && expanded < BUDGET) {
    const node = open.pop()
    expanded++
    const x = poseX[node]
    const y = poseY[node]
    const yaw = poseYaw[node]

    const away = Math.hypot(x - spawn.x, y - spawn.y)
    if (away < closest) closest = away

    if (atSpawn(x, y, yaw)) {
      const route = walkBack(node, parent, heading)
      return { reached: true, expanded, moves: route.moves, reversals: route.reversals, closest: 0 }
    }

    for (const fraction of STEERS) {
      const steer = fraction * car.maxSteerAngle
      // Kinematic bicycle referenced at the centre of gravity, because that is
      // where the pose lives and where the collision box is centred.
      const sideslip = Math.atan((car.cgToRear * Math.tan(steer)) / wheelbase)
      const yawRate = (Math.cos(sideslip) * Math.tan(steer)) / wheelbase
      const advanceX = Math.cos(sideslip)
      const advanceY = Math.sin(sideslip)

      for (const direction of [1, -1]) {
        let nx = x
        let ny = y
        let nyaw = yaw
        let blocked = false
        for (let i = 0; i < SUBSTEPS; i++) {
          const travel = direction * STEP
          const cos = Math.cos(nyaw)
          const sin = Math.sin(nyaw)
          nx += (cos * advanceX - sin * advanceY) * travel
          ny += (sin * advanceX + cos * advanceY) * travel
          nyaw += yawRate * travel
          if (!isClear(runtime, box, nx, ny, nyaw)) {
            blocked = true
            break
          }
        }
        if (blocked) continue
        // A shuffle costs what a metre of driving costs, so a route that only
        // needs one is preferred to a route that needs six.
        const swap = heading[node] !== 0 && heading[node] !== direction ? 1 : 0
        admit(nx, ny, nyaw, node, direction, cost[node] + STEP * SUBSTEPS + swap)
      }
    }
  }

  return { reached: false, expanded, moves: 0, reversals: 0, closest }
}

/**
 * A handful of poses the parking check accepts, spread across the bay rather
 * than only its exact middle: a tight bay is often enterable a hand's width
 * off centre and not dead centre, and the game accepts both.
 */
function parkedPoses(
  runtime: LevelRuntime,
  definition: LevelDefinition,
  car: CarParams,
  box: Obb,
): { x: number; y: number; yaw: number }[] {
  const target = definition.target
  const cos = Math.cos(target.angle)
  const sin = Math.sin(target.angle)
  const state = createVehicleState(0, 0, 0)
  const powertrain = createPowertrainState('manual', car.powertrain.idleRpm)
  powertrain.gear = NEUTRAL_GEAR
  const check = createParkingCheck()

  const poses: { x: number; y: number; yaw: number }[] = []
  for (const along of [0, -0.25, 0.25]) {
    for (const across of [0, -0.12, 0.12]) {
      for (const turn of [0, Math.PI]) {
        const x = target.x + cos * along - sin * across
        const y = target.y + sin * along + cos * across
        const yaw = target.angle + turn
        if (!isClear(runtime, box, x, y, yaw)) continue
        state.x = x
        state.y = y
        state.yaw = yaw
        state.vx = 0
        state.vy = 0
        checkParking(check, state, car, powertrain, false, runtime.targetBox, definition.params)
        if (check.centred && check.wheelsInside && check.aligned) poses.push({ x, y, yaw })
      }
    }
  }
  return poses
}

function isClear(runtime: LevelRuntime, box: Obb, x: number, y: number, yaw: number): boolean {
  setObbPose(box, x, y, yaw)
  const bounds = boundsOf(box)
  const world = runtime.world
  const count = queryGrid(
    world.grid,
    bounds.minX,
    bounds.minY,
    bounds.maxX,
    bounds.maxY,
    world.candidates,
  )
  for (let i = 0; i < count; i++) {
    if (collideObb(box, world.bodies[world.candidates[i]].box, contact)) return false
  }
  return true
}

/** Length of the route found, and how many times it changed direction. */
function walkBack(
  node: number,
  parent: readonly number[],
  heading: readonly number[],
): { moves: number; reversals: number } {
  let moves = 0
  let reversals = 0
  let last = 0
  for (let at = node; at >= 0 && parent[at] >= 0; at = parent[at]) {
    moves++
    const direction = heading[at]
    if (last !== 0 && direction !== last) reversals++
    last = direction
  }
  return { moves, reversals }
}

interface PoseGrid {
  readonly columns: number
  readonly rows: number
  key(x: number, y: number, yaw: number): number
}

/** The lot, as cells the search dedupes poses in. */
function poseGrid(definition: LevelDefinition): PoseGrid {
  const bounds = definition.bounds
  const points =
    bounds.kind === 'poligono'
      ? bounds.points
      : ([
          [bounds.x, bounds.y],
          [bounds.x + bounds.width, bounds.y + bounds.height],
        ] as const)

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  // A car standing against the boundary reaches past it by half its length.
  minX -= 4
  minY -= 4
  maxX += 4
  maxY += 4

  const columns = Math.ceil((maxX - minX) / CELL)
  const rows = Math.ceil((maxY - minY) / CELL)
  const binSize = TAU / YAW_BINS

  return {
    columns,
    rows,
    key(x: number, y: number, yaw: number): number {
      const column = Math.floor((x - minX) / CELL)
      const row = Math.floor((y - minY) / CELL)
      if (column < 0 || row < 0 || column >= columns || row >= rows) return -1
      let bin = Math.floor((((yaw % TAU) + TAU) % TAU) / binSize)
      if (bin >= YAW_BINS) bin = 0
      return (row * columns + column) * YAW_BINS + bin
    },
  }
}

function shortestAngle(angle: number): number {
  const wrapped = ((angle % TAU) + TAU) % TAU
  return wrapped > Math.PI ? wrapped - TAU : wrapped
}

/** A binary heap of node indices, ordered by their estimate. */
class Heap {
  private readonly nodes: number[] = []
  private readonly scores: number[] = []

  get size(): number {
    return this.nodes.length
  }

  push(node: number, score: number): void {
    this.nodes.push(node)
    this.scores.push(score)
    let at = this.nodes.length - 1
    while (at > 0) {
      const above = (at - 1) >> 1
      if (this.scores[above] <= this.scores[at]) break
      this.swap(at, above)
      at = above
    }
  }

  pop(): number {
    const top = this.nodes[0]
    const node = this.nodes.pop() as number
    const score = this.scores.pop() as number
    if (this.nodes.length === 0) return top

    this.nodes[0] = node
    this.scores[0] = score
    let at = 0
    for (;;) {
      const left = at * 2 + 1
      const right = left + 1
      let smallest = at
      if (left < this.nodes.length && this.scores[left] < this.scores[smallest]) smallest = left
      if (right < this.nodes.length && this.scores[right] < this.scores[smallest]) smallest = right
      if (smallest === at) break
      this.swap(at, smallest)
      at = smallest
    }
    return top
  }

  private swap(a: number, b: number): void {
    const node = this.nodes[a]
    this.nodes[a] = this.nodes[b]
    this.nodes[b] = node
    const score = this.scores[a]
    this.scores[a] = this.scores[b]
    this.scores[b] = score
  }
}
