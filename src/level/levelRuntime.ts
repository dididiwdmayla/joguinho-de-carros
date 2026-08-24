/**
 * Turning a level file into the two things the game actually runs on: a set of
 * boxes to collide with, and a scene to draw.
 *
 * Both are built once, here, when the level is chosen. Nothing in the frame
 * loop ever looks at the level file again -- it looks at the boxes and at the
 * scene, which is why a lot with thirty cars costs the same per frame as an
 * empty one.
 *
 * Every size comes from the asset manifest, in metres. A parked van is 5.0 m
 * long because the manifest says so, and its collision box is 5.0 m long for
 * the same reason: there is one number, and the drawing and the physics both
 * read it.
 */
import type { AssetStore } from '../assets/loader'
import { randomBetween, streamFor, type Random } from '../core/random'
import { createObb, type Obb } from '../collision/obb'
import { createWorld, type CollisionWorld, type StaticBody } from '../collision/world'
import type {
  DecalRenderState,
  PaintSegment,
  PropRenderState,
  Scene,
  SlotRender,
} from '../render/scene'
import { createScene } from '../render/scene'
import { createTintCache, type Tint } from '../render/tint'
import type { BoundsDefinition, LevelDefinition, SlotDefinition } from './levelSchema'

/**
 * Colours the parked cars are painted in. A real car park is mostly silver,
 * white and black with a few strong colours in it, so the list is weighted the
 * same way: the entries with no strength leave the artwork exactly as drawn.
 */
const CAR_COLORS: readonly Tint[] = [
  { hue: 0.0, saturation: 0.0, strength: 0 },
  { hue: 0.0, saturation: 0.0, strength: 0 },
  { hue: 0.6, saturation: 0.55, strength: 0.8 },
  { hue: 0.63, saturation: 0.7, strength: 0.85 },
  { hue: 0.01, saturation: 0.65, strength: 0.85 },
  { hue: 0.97, saturation: 0.5, strength: 0.7 },
  { hue: 0.33, saturation: 0.4, strength: 0.7 },
  { hue: 0.47, saturation: 0.45, strength: 0.7 },
  { hue: 0.08, saturation: 0.5, strength: 0.75 },
  { hue: 0.11, saturation: 0.25, strength: 0.6 },
  { hue: 0.75, saturation: 0.3, strength: 0.6 },
]

/** How thick the invisible wall around the lot is [m]. */
const WALL_THICKNESS = 2

/** Width of a painted bay line [m]. */
export const PAINT_WIDTH = 0.12

/** Length of one worn piece of painted line [m]. */
const PAINT_SEGMENT = 0.55
/** Chance a piece has worn away entirely. */
const PAINT_GAP_CHANCE = 0.09
/** How far a piece may wander off the true line [m]. */
const PAINT_WOBBLE = 0.02

/**
 * How far a parked car may sit from the middle of its bay [m] and how far off
 * square [rad]. Small on purpose: enough that a row of cars is not a ruler,
 * never enough to close a gap the level was designed around.
 */
const PARK_JITTER_LATERAL = 0.07
const PARK_JITTER_ALONG = 0.13
const PARK_JITTER_ANGLE = 0.025

export interface LevelRuntime {
  readonly definition: LevelDefinition
  readonly world: CollisionWorld
  readonly scene: Scene
  /** The bay to park in, as a box: the parking test asks it about points. */
  readonly targetBox: Obb
}

/**
 * Builds everything a level needs. Throws only if a sprite is missing from the
 * store, which the caller has already checked against the manifest.
 */
export function buildLevel(definition: LevelDefinition, assets: AssetStore): LevelRuntime {
  const tints = createTintCache()
  const colors = streamFor(definition.seed, 'cores')
  const jitter = streamFor(definition.seed, 'estacionamento')
  const paint = streamFor(definition.seed, 'pintura')
  const wear = streamFor(definition.seed, 'desgaste')

  const bodies: StaticBody[] = []
  const props: PropRenderState[] = []
  const slots: SlotRender[] = []

  // --- the bays -----------------------------------------------------------
  // The target first, so it is the first thing painted and the first body in
  // the list; the order matters to nobody, but a stable one is worth having.
  const allSlots: readonly SlotDefinition[] = [definition.target, ...definition.slots]
  for (const slot of allSlots) {
    const isTarget = slot === definition.target
    slots.push({
      x: slot.x,
      y: slot.y,
      angle: slot.angle,
      length: slot.length,
      width: slot.width,
      target: isTarget,
      paint: paintForSlot(slot, paint),
    })
    if (slot.occupant === null) continue

    const sprite = assets.sprite(slot.occupant)
    const placed = jitterPose(slot, jitter)
    props.push({
      sprite: tints.get(sprite, pick(CAR_COLORS, colors)),
      x: placed.x,
      y: placed.y,
      yaw: placed.angle,
      shadow: true,
    })
    bodies.push({
      box: createObb(placed.x, placed.y, sprite.lengthMeters, sprite.widthMeters, placed.angle),
      kind: 'carro',
      label: slot.occupant,
    })
  }

  // --- obstacles ----------------------------------------------------------
  for (const obstacle of definition.obstacles) {
    const sprite = assets.sprite(obstacle.type)
    props.push({
      sprite,
      x: obstacle.x,
      y: obstacle.y,
      yaw: obstacle.angle,
      shadow: sprite.lengthMeters > 0.5 || sprite.widthMeters > 0.5,
    })
    bodies.push({
      box: createObb(
        obstacle.x,
        obstacle.y,
        sprite.lengthMeters,
        sprite.widthMeters,
        obstacle.angle,
      ),
      kind: 'obstaculo',
      label: obstacle.type,
    })
  }

  // --- the edge of the world ----------------------------------------------
  for (const wall of boundaryWalls(definition.bounds)) bodies.push(wall)

  // --- what is painted on the asphalt -------------------------------------
  const decals: DecalRenderState[] = definition.decals.map((decal) => ({
    sprite: assets.sprite(decal.type),
    x: decal.x,
    y: decal.y,
    yaw: decal.angle,
    scale: decal.scale,
    // A stain nobody authored the opacity of still should not look printed.
    alpha: randomBetween(wear, 0.55, 0.9),
  }))

  const scene = createScene()
  const tile = assets.sprite(definition.ground.tile)
  scene.ground = {
    sprite: tile,
    x: definition.ground.x,
    y: definition.ground.y,
    width: definition.ground.width,
    height: definition.ground.height,
  }
  scene.boundary = boundaryPolygon(definition.bounds)
  scene.decals = decals
  scene.slots = slots
  scene.props = props

  return {
    definition,
    world: createWorld(bodies),
    scene,
    targetBox: createObb(
      definition.target.x,
      definition.target.y,
      definition.target.length,
      definition.target.width,
      definition.target.angle,
    ),
  }
}

function pick<T>(list: readonly T[], random: Random): T {
  return list[Math.min(list.length - 1, Math.floor(random.next() * list.length))]
}

/** Nobody parks perfectly square. Small enough never to close a real gap. */
function jitterPose(slot: SlotDefinition, random: Random): { x: number; y: number; angle: number } {
  const along = randomBetween(random, -PARK_JITTER_ALONG, PARK_JITTER_ALONG)
  const across = randomBetween(random, -PARK_JITTER_LATERAL, PARK_JITTER_LATERAL)
  const angle = slot.angle + randomBetween(random, -PARK_JITTER_ANGLE, PARK_JITTER_ANGLE)
  return {
    x: slot.x + Math.cos(slot.angle) * along - Math.sin(slot.angle) * across,
    y: slot.y + Math.sin(slot.angle) * along + Math.cos(slot.angle) * across,
    angle,
  }
}

/**
 * The painted lines of one bay, worn.
 *
 * A perpendicular bay is painted as a U: two sides and the closed end the nose
 * comes to rest against. A parallel one gets the whole rectangle, which is how
 * a kerbside bay is actually marked.
 */
function paintForSlot(slot: SlotDefinition, random: Random): PaintSegment[] {
  const cos = Math.cos(slot.angle)
  const sin = Math.sin(slot.angle)
  const halfLength = slot.length / 2
  const halfWidth = slot.width / 2
  /** Bay-local metres -> world. */
  const at = (along: number, across: number): [number, number] => [
    slot.x + cos * along - sin * across,
    slot.y + sin * along + cos * across,
  ]

  const corners = {
    frontLeft: at(halfLength, -halfWidth),
    frontRight: at(halfLength, halfWidth),
    backLeft: at(-halfLength, -halfWidth),
    backRight: at(-halfLength, halfWidth),
  }

  const segments: PaintSegment[] = []
  const line = (from: [number, number], to: [number, number]): void => {
    wearLine(from, to, random, segments)
  }
  line(corners.backLeft, corners.frontLeft)
  line(corners.backRight, corners.frontRight)
  line(corners.frontLeft, corners.frontRight)
  if (slot.style === 'paralela') line(corners.backLeft, corners.backRight)
  return segments
}

/**
 * One straight line, broken into short pieces that each fade and wander a
 * little. Paint on a car park is never a clean edge, and a clean edge is
 * exactly what makes a top-down scene look like a diagram.
 */
function wearLine(
  from: readonly [number, number],
  to: readonly [number, number],
  random: Random,
  out: PaintSegment[],
): void {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const length = Math.hypot(dx, dy)
  if (length <= 0) return
  const steps = Math.max(1, Math.round(length / PAINT_SEGMENT))
  const ux = dx / length
  const uy = dy / length
  // Perpendicular, for the wobble.
  const px = -uy
  const py = ux

  for (let i = 0; i < steps; i++) {
    if (random.next() < PAINT_GAP_CHANCE) continue
    const startAt = (i / steps) * length
    const endAt = ((i + 1) / steps) * length
    const offset1 = randomBetween(random, -PAINT_WOBBLE, PAINT_WOBBLE)
    const offset2 = randomBetween(random, -PAINT_WOBBLE, PAINT_WOBBLE)
    out.push({
      x1: from[0] + ux * startAt + px * offset1,
      y1: from[1] + uy * startAt + py * offset1,
      x2: from[0] + ux * endAt + px * offset2,
      y2: from[1] + uy * endAt + py * offset2,
      alpha: randomBetween(random, 0.34, 0.78),
    })
  }
}

/** The playable area as a closed polygon, whichever way it was written. */
export function boundaryPolygon(bounds: BoundsDefinition): readonly (readonly [number, number])[] {
  if (bounds.kind === 'poligono') return bounds.points
  const { x, y, width, height } = bounds
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ]
}

/**
 * A wall per edge, sitting just outside it.
 *
 * The car is stopped by the same collision as everything else -- there is no
 * separate "you left the area" rule anywhere in the game, because a rule like
 * that always disagrees with the picture sooner or later. The walls are simply
 * boxes nobody draws.
 *
 * Which side is outside comes from the polygon's own winding, not from
 * guessing against its centre: an L-shaped lot has edges whose outside is
 * towards the middle of the shape, and a guess gets those backwards.
 */
export function boundaryWalls(bounds: BoundsDefinition): StaticBody[] {
  const points = boundaryPolygon(bounds)
  const walls: StaticBody[] = []
  const winding = signedArea(points) >= 0 ? 1 : -1

  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    const dx = x2 - x1
    const dy = y2 - y1
    const length = Math.hypot(dx, dy)
    if (length <= 0) continue

    const outX = (winding * dy) / length
    const outY = (-winding * dx) / length
    walls.push({
      box: createObb(
        (x1 + x2) / 2 + (outX * WALL_THICKNESS) / 2,
        (y1 + y2) / 2 + (outY * WALL_THICKNESS) / 2,
        // Overlong on purpose, so two walls always meet around a corner
        // instead of leaving a gap a bumper could find.
        length + WALL_THICKNESS * 2,
        WALL_THICKNESS,
        Math.atan2(dy, dx),
      ),
      kind: 'muro',
      label: 'limite',
    })
  }
  return walls
}

/** Shoelace area; its sign is the winding. */
function signedArea(points: readonly (readonly [number, number])[]): number {
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    total += x1 * y2 - x2 * y1
  }
  return total / 2
}
