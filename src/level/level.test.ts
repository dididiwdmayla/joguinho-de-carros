/**
 * Collision, level and parking checks, run with `npm test`.
 *
 * No framework and no dependency: every expectation goes through `check`, and
 * a run with any failed expectation throws at the end, which is a non-zero
 * exit code for whatever is calling it.
 *
 * What is being proved here. That a sprite is measured to its bodywork, so the
 * box the physics uses is the car the player sees. That the separating axis
 * test and the response do what a car hitting scenery should do -- stop
 * without bouncing, stop against what it touched rather than short of it,
 * slide along a wall taken at a shallow angle, never end up outside the lot.
 * That parking means what the brief says it means, hold included, and that a
 * clean run is scored as one. And that every level that ships can actually be
 * driven: the bays are as tight as they are meant to be, there is a manoeuvre
 * from the spawn into each of them, and all three gearboxes can perform it.
 */
import manifestJson from '../data/assets.json' with { type: 'json' }
import sedanJson from '../data/cars/player_sedan.json' with { type: 'json' }
import level01 from '../data/levels/01-vaga-isolada.json' with { type: 'json' }
import level02 from '../data/levels/02-entre-dois-carros.json' with { type: 'json' }
import level03 from '../data/levels/03-baliza-tranquila.json' with { type: 'json' }
import level04 from '../data/levels/04-van-e-pickup.json' with { type: 'json' }
import level05 from '../data/levels/05-baliza-apertada.json' with { type: 'json' }

import type { AssetManifest } from '../assets/manifest'
import { spriteQuad, type AssetStore, type LoadedSprite } from '../assets/loader'
import { measureSpriteBounds } from '../assets/spriteBounds'
import { buildGrid, queryGrid } from '../collision/grid'
import {
  collideObb,
  createContact,
  createObb,
  obbContains,
  setObbPose,
  type Obb,
} from '../collision/obb'
import {
  createDamageLog,
  resolveVehicleCollisions,
  type ColliderMotion,
  type VehicleCollider,
} from '../collision/vehicleCollision'
import { boundsOf, createWorld, type CollisionWorld } from '../collision/world'
import { FIXED_DT } from '../core/constants'
import { clamp, radToDeg } from '../core/math'
import { isBetter, type LevelRecord } from '../game/progress'
import { createInputState } from '../input/input'
import { parseCarParams, type CarParams } from '../vehicle/carParams'
import { createTelemetry, stepVehicle } from '../vehicle/physics'
import {
  applyPowertrainCommand,
  createPowertrainState,
  NEUTRAL_GEAR,
  REVERSE_GEAR,
  type PowertrainCommand,
} from '../vehicle/powertrain'
import { createVehicleState, type VehicleState } from '../vehicle/vehicleState'
import {
  advanceRun,
  chooseLevel,
  completeRun,
  createFlowState,
  leaveToMenu,
  levelReady,
  pauseRun,
  resumeRun,
} from '../game/flow'
import { buildLevel, boundaryWalls, type LevelRuntime } from './levelRuntime'
import { reachTargetBay } from './reachability'
import { checkParking, createParkingCheck, createParkingState, stepParking } from './parking'
import { parseLevel, validateLevelSprites, type LevelDefinition } from './levelSchema'
import { scoreRun } from './scoring'

const manifest = manifestJson as unknown as AssetManifest
const car: CarParams = parseCarParams(sedanJson, 'player_sedan.json')

let failures = 0

function check(passed: boolean, message: string): void {
  if (passed) return
  failures++
  console.log(`  FALHOU: ${message}`)
}

function section(title: string): void {
  console.log(title)
}

// --------------------------------------------------------------- fake assets
// Sizes come from the manifest, exactly as they do in the browser. There are
// no images in a terminal, and none of the geometry cares: a sprite is a size
// in metres with a picture attached, and only the size is being tested.
function fakeAssets(): AssetStore {
  const cache = new Map<string, LoadedSprite>()
  return {
    sprite(key: string): LoadedSprite {
      const existing = cache.get(key)
      if (existing !== undefined) return existing
      const entry = manifest.sprites[key]
      if (entry === undefined) throw new Error(`sprite "${key}" nao existe no manifesto`)
      const sprite: LoadedSprite = {
        key,
        image: {} as HTMLImageElement,
        lengthMeters: entry.lengthMeters,
        widthMeters: entry.widthMeters,
        trim: { x: 0, y: 0, width: 1, height: 1 },
        quad: {
          x: -entry.lengthMeters / 2,
          y: -entry.widthMeters / 2,
          width: entry.lengthMeters,
          height: entry.widthMeters,
        },
        blend: entry.blend,
      }
      cache.set(key, sprite)
      return sprite
    },
    ui(key: string): never {
      throw new Error(`nenhuma imagem de UI nos testes: ${key}`)
    },
  }
}

const assets = fakeAssets()

/** The car's box: the bodywork the manifest declares, as the game builds it. */
function playerBox(x: number, y: number, yaw: number): Obb {
  const sprite = manifest.sprites['player_sedan']
  return createObb(x, y, sprite.lengthMeters, sprite.widthMeters, yaw)
}

const contact = createContact()

/** Brute force: every body, no grid. The grid is checked against this below. */
function firstHit(world: CollisionWorld, box: Obb): string | null {
  for (const body of world.bodies) {
    if (collideObb(box, body.box, contact)) return `${body.kind}:${body.label}`
  }
  return null
}

/** How far into anything the box still is [m]. */
function deepestOverlap(world: CollisionWorld, box: Obb): number {
  let deepest = 0
  for (const body of world.bodies) {
    if (collideObb(box, body.box, contact) && contact.depth > deepest) deepest = contact.depth
  }
  return deepest
}

// ------------------------------------------------------------------- the SAT

section('separating axis test')
{
  const a = createObb(0, 0, 4, 2, 0)
  check(!collideObb(a, createObb(5, 0, 4, 2, 0), contact), 'caixas afastadas nao colidem')
  check(collideObb(a, createObb(3.5, 0, 4, 2, 0), contact), 'caixas sobrepostas colidem')

  // Nose into a wall on the right: the box reaches x=2, the wall starts at
  // 1.5, so the way out is towards -X and the depth is exactly the overlap.
  const wall = createObb(2.5, 0, 2, 10, 0)
  check(collideObb(a, wall, contact), 'carro dentro do muro colide')
  check(contact.nx < -0.99, `normal aponta para fora do muro (nx=${contact.nx.toFixed(3)})`)
  check(Math.abs(contact.depth - 0.5) < 1e-9, `profundidade 0,5 m (${contact.depth.toFixed(4)})`)

  // A box turned 45 degrees reaches its corner out where the same box square
  // to the world has nothing at all.
  const corner = createObb(0.75, 2.0, 0.4, 0.4, 0)
  const turned = createObb(0, 0, 4, 2, Math.PI / 4)
  check(collideObb(turned, corner, contact), 'a quina da caixa girada alcanca')
  check(!collideObb(a, corner, contact), 'a mesma caixa reta nao alcanca')

  check(obbContains(a, 1.9, 0.9), 'ponto dentro da caixa')
  check(!obbContains(a, 2.1, 0), 'ponto fora da caixa')
}

// ------------------------------------------------------------- the broad phase

section('grade espacial')
{
  const boxes: Obb[] = []
  for (let i = 0; i < 60; i++) {
    boxes.push(createObb((i % 10) * 5, Math.floor(i / 10) * 5, 4.6, 1.8, (i % 4) * 0.3))
  }
  const grid = buildGrid(boxes.map(boundsOf), 6)
  const out: number[] = []
  const probe = createObb(22, 12, 4.5, 1.8, 0.4)
  const bounds = boundsOf(probe)
  const found = queryGrid(grid, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, out)

  const reported = new Set(out.slice(0, found))
  check(reported.size === found, 'a consulta nao repete um corpo')
  check(found < boxes.length, `a grade descarta a maioria (${found} de ${boxes.length})`)

  // Everything the brute force finds has to be in the shortlist. The other way
  // round is allowed: a broad phase may over-report, never under-report.
  let missed = 0
  for (let i = 0; i < boxes.length; i++) {
    if (collideObb(probe, boxes[i], contact) && !reported.has(i)) missed++
  }
  check(missed === 0, `a grade nao perde nenhuma colisao real (${missed} perdidas)`)
}

// ------------------------------------------------------------- the response

section('resposta a colisao')
{
  const collider: VehicleCollider = {
    box: playerBox(0, 0, 0),
    mass: car.mass,
    inertia: car.yawInertia,
    restitution: 0.02,
    friction: 0.32,
  }
  const log = createDamageLog()

  // Straight into a wall at 5 m/s: the car stops against it and is not thrown
  // back. Anything more than a crawl in reverse would be a pinball.
  {
    const world = createWorld([
      { box: createObb(10, 0, 2, 20, 0), kind: 'muro', label: 'muro' },
    ])
    const motion: ColliderMotion = { x: 7.1, y: 0, vx: 5, vy: 0, yaw: 0, yawRate: 0 }
    setObbPose(collider.box, motion.x, motion.y, motion.yaw)
    const impact = resolveVehicleCollisions(world, collider, motion, log)
    check(impact > 4.9 && impact < 5.1, `o impacto vale a velocidade de aproximacao (${impact.toFixed(2)})`)
    check(log.total > 4.9, `o dano acumula o impacto (${log.total.toFixed(2)})`)
    check(motion.vx <= 0.001, `nao segue entrando no muro (vx=${motion.vx.toFixed(3)})`)
    check(motion.vx > -0.2, `nao e arremessado de volta (vx=${motion.vx.toFixed(3)})`)
    check(motion.x < 7.1, 'o carro e empurrado para fora do muro')
    // Out of the wall, bar the tenth of a millimetre the response leaves on
    // purpose so a resting contact does not chatter.
    const left = deepestOverlap(world, playerBox(motion.x, motion.y, motion.yaw))
    check(left < 0.002, `sai do muro (sobrou ${(left * 1000).toFixed(2)} mm)`)
  }

  // The same wall taken at ten degrees, over a second of contact: the car
  // slides along it instead of stopping against it, and comes away with
  // almost all of the speed it arrived with, pointing where the wall points.
  {
    const world = createWorld([
      { box: createObb(0, 10, 60, 2, 0), kind: 'muro', label: 'muro' },
    ])
    const angle = (10 * Math.PI) / 180
    const speed = 6
    const motion: ColliderMotion = {
      x: -6,
      y: 8.15,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      yaw: angle,
      yawRate: 0,
    }
    for (let i = 0; i < 60; i++) {
      motion.x += motion.vx * FIXED_DT
      motion.y += motion.vy * FIXED_DT
      motion.yaw += motion.yawRate * FIXED_DT
      setObbPose(collider.box, motion.x, motion.y, motion.yaw)
      resolveVehicleCollisions(world, collider, motion, log)
    }
    const after = Math.hypot(motion.vx, motion.vy)
    check(after > speed * 0.75, `raspar conserva a velocidade (${after.toFixed(2)} de ${speed})`)
    check(motion.vx > speed * 0.75, `e continua ao longo do muro (vx=${motion.vx.toFixed(2)})`)
    check(motion.vy < 0.35, `sem seguir entrando nele (vy=${motion.vy.toFixed(3)})`)
    check(motion.x + 6 > 4.5, `sem travar: andou ${(motion.x + 6).toFixed(1)} m ao longo do muro`)
    check(motion.y < 9.4, 'e nao foi arremessado para longe do muro')
  }
}

// ------------------------------------------------------- measuring a sprite

section('medida dos sprites')
{
  /**
   * A car as the art actually has it: padding all round, a soft halo on the
   * silhouette, and two wing mirrors sticking out past the sides. Only the
   * bodywork may end up as the metres, because only the bodywork is what the
   * manifest means by "1.8 m wide".
   */
  const width = 200
  const height = 120
  const pixels = new Uint8ClampedArray(width * height * 4)
  const setAlpha = (x: number, y: number, alpha: number): void => {
    pixels[(y * width + x) * 4 + 3] = alpha
  }

  // Bodywork: solid, x 40..159, y 40..79.
  for (let y = 40; y <= 79; y++) for (let x = 40; x <= 159; x++) setAlpha(x, y, 255)
  // A one-pixel halo around it, faint but not padding.
  for (let y = 39; y <= 80; y++) for (let x = 39; x <= 160; x++) {
    if (pixels[(y * width + x) * 4 + 3] === 0) setAlpha(x, y, 60)
  }
  // Two mirrors: solid, eight pixels long, hanging six past each side.
  for (let y = 34; y <= 39; y++) for (let x = 96; x <= 103; x++) setAlpha(x, y, 255)
  for (let y = 80; y <= 85; y++) for (let x = 96; x <= 103; x++) setAlpha(x, y, 255)

  const bounds = measureSpriteBounds(pixels, width, height)
  check(
    bounds.trim.x === 39 && bounds.trim.width === 122,
    `o recorte pega o halo (x=${bounds.trim.x} l=${bounds.trim.width})`,
  )
  check(
    bounds.trim.y === 34 && bounds.trim.height === 52,
    `e os espelhos (y=${bounds.trim.y} a=${bounds.trim.height})`,
  )
  check(
    bounds.body.x === 40 && bounds.body.width === 120,
    `a lataria e so a chapa (x=${bounds.body.x} l=${bounds.body.width})`,
  )
  check(
    bounds.body.y === 40 && bounds.body.height === 40,
    `sem os espelhos na largura (y=${bounds.body.y} a=${bounds.body.height})`,
  )

  // And the quad that comes out of it puts the bodywork at exactly the metres
  // asked for, centred, with the mirrors hanging off outside.
  const quad = spriteQuad(bounds, 4.5, 1.8)
  const bodyLeft = quad.x + (bounds.body.x - bounds.trim.x) * (quad.width / bounds.trim.width)
  const bodyTop = quad.y + (bounds.body.y - bounds.trim.y) * (quad.height / bounds.trim.height)
  check(Math.abs(bodyLeft + 2.25) < 1e-9, `a lataria comeca em -2,25 m (${bodyLeft.toFixed(4)})`)
  check(Math.abs(bodyTop + 0.9) < 1e-9, `e em -0,90 m (${bodyTop.toFixed(4)})`)
  check(quad.height > 1.8, `os espelhos passam da lataria (${quad.height.toFixed(3)} m)`)

  // Art with no padding and nothing sticking out -- a ground tile -- must come
  // back untouched, or every lot in the game shifts by a pixel.
  const solid = new Uint8ClampedArray(8 * 8 * 4)
  for (let i = 3; i < solid.length; i += 4) solid[i] = 255
  const tile = measureSpriteBounds(solid, 8, 8)
  check(
    tile.trim.width === 8 && tile.trim.height === 8 && tile.body.width === 8 && tile.body.height === 8,
    'uma textura cheia mede o arquivo inteiro',
  )
}

// ------------------------------------------------------------------- levels

const definitions: LevelDefinition[] = [
  parseLevel(level01, '01-vaga-isolada.json'),
  parseLevel(level02, '02-entre-dois-carros.json'),
  parseLevel(level03, '03-baliza-tranquila.json'),
  parseLevel(level04, '04-van-e-pickup.json'),
  parseLevel(level05, '05-baliza-apertada.json'),
]

section('paredes dos limites')
{
  // A square written clockwise and the same square written the other way
  // round have to produce the same walls: the winding decides which side is
  // outside, and getting it wrong walls the player out of the level.
  for (const points of [
    [[0, 0], [20, 0], [20, 12], [0, 12]],
    [[0, 12], [20, 12], [20, 0], [0, 0]],
  ] as (readonly [number, number])[][]) {
    const walls = boundaryWalls({ kind: 'poligono', points })
    const world = createWorld(walls.map((wall) => ({ ...wall })))
    check(walls.length === 4, 'um muro por aresta')
    check(firstHit(world, playerBox(10, 6, 0)) === null, 'o meio da area fica livre')
    check(firstHit(world, playerBox(10, 6, 0.7)) === null, 'e livre em qualquer angulo')
    check(firstHit(world, playerBox(10, -1.5, 0)) !== null, 'atras do limite ha muro')
    check(firstHit(world, playerBox(22, 6, 0)) !== null, 'e dos dois lados')
  }
}

section('fases')

/** True when the car placed here touches nothing. */
function clearAt(runtime: LevelRuntime, x: number, y: number, yaw: number): boolean {
  return firstHit(runtime.world, playerBox(x, y, yaw)) === null
}

/** Sweeps the car from a pose along a direction, in 25 cm steps. */
function corridorClear(
  runtime: LevelRuntime,
  x: number,
  y: number,
  yaw: number,
  dirX: number,
  dirY: number,
  distance: number,
): boolean {
  const steps = Math.ceil(distance / 0.25)
  for (let i = 0; i <= steps; i++) {
    const travel = (i / steps) * distance
    if (!clearAt(runtime, x + dirX * travel, y + dirY * travel, yaw)) return false
  }
  return true
}

for (const definition of definitions) {
  validateLevelSprites(definition, manifest)
  const runtime = buildLevel(definition, assets)
  const target = definition.target
  const cos = Math.cos(target.angle)
  const sin = Math.sin(target.angle)
  const name = definition.id

  check(clearAt(runtime, definition.spawn.x, definition.spawn.y, definition.spawn.angle),
    `${name}: o spawn esta livre`)

  // Parked dead centre, the car touches nothing -- with the jitter of the
  // neighbours already applied, because that is the lot the player gets.
  const hit = firstHit(runtime.world, playerBox(target.x, target.y, target.angle))
  check(hit === null, `${name}: a vaga alvo esta livre (${hit ?? 'ok'})`)

  // And the bay really does hold the whole car: the parking test asks about
  // the wheels, so a bay the car does not fit in can never be won.
  const parked = createVehicleState(target.x, target.y, target.angle)
  const powertrain = createPowertrainState('manual', car.powertrain.idleRpm)
  powertrain.gear = NEUTRAL_GEAR
  const result = checkParking(
    createParkingCheck(),
    parked,
    car,
    powertrain,
    false,
    runtime.targetBox,
    definition.params,
  )
  check(result.satisfied, `${name}: o carro no centro da vaga valida`)

  // A way in. A perpendicular bay is entered along its own axis; a parallel
  // one is entered from the lane beside it, so the lane is what has to be
  // clear -- on whichever side of the bay the road happens to be.
  if (target.style === 'perpendicular') {
    const out = corridorClear(runtime, target.x, target.y, target.angle, -cos, -sin, 5)
    const inward = corridorClear(runtime, target.x, target.y, target.angle, cos, sin, 2.5)
    check(out || inward, `${name}: existe corredor reto de entrada na vaga`)
  } else {
    const lane = target.width / 2 + car.width / 2 + 0.5
    const along = 7
    const left = corridorClear(runtime, target.x - sin * -lane, target.y + cos * -lane, target.angle, cos, sin, along) &&
      corridorClear(runtime, target.x - sin * -lane, target.y + cos * -lane, target.angle, -cos, -sin, along)
    const right = corridorClear(runtime, target.x - sin * lane, target.y + cos * lane, target.angle, cos, sin, along) &&
      corridorClear(runtime, target.x - sin * lane, target.y + cos * lane, target.angle, -cos, -sin, along)
    check(left || right, `${name}: existe faixa de rolamento ao lado da baliza`)

    // And the gap between the neighbours takes the car with room to shuffle.
    const slack = (target.length - car.length) / 2
    check(slack > 0.4, `${name}: a vaga e maior que o carro (${slack.toFixed(2)} m de folga)`)
    // Half a step either way inside the bay. Not the whole slack: a car parked
    // at the very end of a tight bay is touching a neighbour by design, and
    // what has to be true is that it is not wedged in the middle of it.
    const shuffle = 0.4
    check(
      corridorClear(runtime, target.x, target.y, target.angle, cos, sin, shuffle) &&
        corridorClear(runtime, target.x, target.y, target.angle, -cos, -sin, shuffle),
      `${name}: o carro se mexe dentro da baliza sem tocar nos vizinhos`,
    )
  }

  // The lot is a place, not a plane: the spawn is inside the paved area.
  const ground = definition.ground
  check(
    definition.spawn.x > ground.x &&
      definition.spawn.x < ground.x + ground.width &&
      definition.spawn.y > ground.y &&
      definition.spawn.y < ground.y + ground.height,
    `${name}: o spawn esta sobre o asfalto`,
  )
}

// ----------------------------------------------------------- the difficulty

/**
 * The curve the five bays are calibrated to, in the terms a driver would use.
 *
 * A perpendicular bay is described by how much room there is beside the car; a
 * parallel one by how much longer than the car the bay is, because that is the
 * number a baliza lives or dies by. Written down here so a level file cannot
 * quietly drift back towards a car park made of aircraft hangars: the reference
 * is a real bay, 2.4 m wide for a 1.8 m car.
 */
const BAY_CURVE: Record<string, { readonly side?: number; readonly lengths?: number }> = {
  '01-vaga-isolada': { side: 0.6 },
  '02-entre-dois-carros': { side: 0.4 },
  '03-baliza-tranquila': { lengths: 1.4 },
  '04-van-e-pickup': { side: 0.25 },
  '05-baliza-apertada': { lengths: 1.25 },
}

/**
 * How much looser than the bay's own slack a centre tolerance may be [m].
 *
 * Some headroom is right -- a car parked a hand's width off centre is parked --
 * but not so much that the tolerance stops following the bay. The teaching
 * level sits at the loose end of this on purpose.
 */
const TOLERANCE_HEADROOM = 0.3

section('a folga das vagas')
for (const definition of definitions) {
  const target = definition.target
  const wanted = BAY_CURVE[definition.id]
  const name = definition.id

  if (wanted.side !== undefined) {
    const side = (target.width - car.width) / 2
    check(
      Math.abs(side - wanted.side) < 0.03,
      `${name}: ${(side * 100).toFixed(0)} cm de cada lado (queria ${(wanted.side * 100).toFixed(0)})`,
    )
  }
  if (wanted.lengths !== undefined) {
    const factor = target.length / car.length
    check(
      Math.abs(factor - wanted.lengths) < 0.04,
      `${name}: vaga de ${factor.toFixed(2)} carro (queria ${wanted.lengths.toFixed(2)})`,
    )
  }

  // And the validation follows the bay rather than sitting where it was: a
  // tight bay with a loose tolerance is not harder, only more confusing. The
  // centre tolerance has to be inside the bay's own slack plus a little, and
  // never so tight that the middle of the bay is the only place that counts.
  const slack = Math.min((target.width - car.width) / 2, (target.length - car.length) / 2)
  check(
    definition.params.centerTolerance <= slack + TOLERANCE_HEADROOM + 1e-9,
    `${name}: a tolerancia de centro segue a vaga ` +
      `(${definition.params.centerTolerance} m para ${slack.toFixed(2)} m de folga)`,
  )
  check(
    definition.params.centerTolerance >= slack * 0.8,
    `${name}: mas nao exige o milimetro (${definition.params.centerTolerance} m)`,
  )
}

// ------------------------------------------------------ getting into the bay

/**
 * Every bay was tightened, so every bay has to be proved enterable again --
 * with the collision box that is now the whole car rather than five per cent
 * inside it. This is the search over the car's own kinematics; what it comes
 * back with is a route and how many shuffles that route needed, which is the
 * only honest reading of how hard a bay is.
 */
section('a vaga e alcancavel')
{
  const size = {
    length: manifest.sprites['player_sedan'].lengthMeters,
    width: manifest.sprites['player_sedan'].widthMeters,
  }
  for (const definition of definitions) {
    const runtime = buildLevel(definition, assets)
    const result = reachTargetBay(runtime, definition, car, size)
    check(
      result.reached,
      `${definition.id}: existe manobra do spawn ate a vaga ` +
        `(${result.expanded} poses, faltaram ${result.closest.toFixed(2)} m)`,
    )
    if (!result.reached) continue
    console.log(
      `  ${definition.id}: ${result.moves} arcos, ${result.reversals} inversao(oes) de marcha`,
    )
  }
}

// --------------------------------------------------- and drivable in all three

/**
 * The geometry says the bay can be reached; this says the car can be made to
 * move at all, in each of the three gearboxes, forwards and in reverse, at the
 * pace a car park is driven at. Together they are what "completable in every
 * mode" means -- the modes differ in how torque is asked for, never in where
 * the car can go.
 */
section('as tres transmissoes manobram')
{
  /** The crawl a car park is driven at [m/s]: about four kilometres an hour. */
  const CREEP_SPEED = 1.2
  /** Driving, then stopping: six seconds of one and two of the other. */
  const DRIVE_TIME = 6
  const TOTAL_TIME = 8

  for (const mode of ['automatic', 'sequential', 'manual'] as const) {
    for (const forward of [true, false]) {
      const powertrain = createPowertrainState(mode, car.powertrain.idleRpm)
      const telemetry = createTelemetry(powertrain)
      const state = createVehicleState(0, 0, 0)
      const input = createInputState()
      const wanted = forward ? 1 : REVERSE_GEAR

      let stalls = 0
      let wasStalled = false
      let fastest = 0

      for (let step = 0; step < TOTAL_TIME / FIXED_DT; step++) {
        const time = step * FIXED_DT
        const speed = Math.abs(state.vx)
        const stopping = time > DRIVE_TIME

        // The clutch, on the floor until the gear is in and then eased up on
        // the engine speed. That is what slipping a clutch is, and it is the
        // only way a manual leaves a parking space: let it straight out and
        // the engine dies, hold it down and nothing moves.
        if (mode === 'manual') {
          input.clutchPress =
            powertrain.gear !== wanted ? 1 : clamp(0.78 - (powertrain.rpm - 1150) / 1200, 0.2, 0.85)
        }

        // Into gear the way each box is asked for it: a selector position for
        // the automatic, one notch at a time for the sequential, the lever for
        // the manual. Asked every step until the box has it, because each of
        // them is entitled to refuse until its own conditions are met.
        if (powertrain.gear !== wanted) {
          const command: PowertrainCommand =
            mode === 'automatic'
              ? { kind: 'selectAuto', position: forward ? 'D' : 'R' }
              : mode === 'sequential'
                ? powertrain.gear < wanted
                  ? { kind: 'shiftUp' }
                  : { kind: 'shiftDown' }
                : { kind: 'selectGear', gear: wanted }
          applyPowertrainCommand(powertrain, car.powertrain, command, state.vx)
        }

        input.throttle = stopping ? 0 : clamp(0.22 + (CREEP_SPEED - speed) * 0.35, 0.1, 0.6)
        input.brake = stopping ? 0.5 : 0

        stepVehicle(state, car, powertrain, input, FIXED_DT, telemetry)
        if (powertrain.stalled && !wasStalled) stalls++
        wasStalled = powertrain.stalled
        if (!stopping) fastest = Math.max(fastest, Math.abs(state.vx))
      }

      const travelled = forward ? state.x : -state.x
      const way = forward ? 'para frente' : 'de re'
      check(travelled > 3, `${mode} manobra ${way} (${travelled.toFixed(1)} m em ${DRIVE_TIME} s)`)
      check(stalls === 0, `${mode} ${way} sem matar o motor (${stalls}x)`)
      check(
        fastest * 3.6 < 12,
        `${mode} ${way} em passo de manobra (pico ${(fastest * 3.6).toFixed(1)} km/h)`,
      )
      check(
        Math.abs(state.vx) < 0.05,
        `${mode} ${way} para no freio (${(Math.abs(state.vx) * 3.6).toFixed(2)} km/h)`,
      )
    }
  }
}

// --------------------------------------------------------------- the hold

section('validacao da vaga')
{
  const definition = definitions[0]
  const runtime = buildLevel(definition, assets)
  const params = definition.params
  const powertrain = createPowertrainState('manual', car.powertrain.idleRpm)
  powertrain.gear = NEUTRAL_GEAR

  const parked = createVehicleState(definition.target.x, definition.target.y, definition.target.angle)
  const state = createParkingState()

  // Half the hold is not the hold.
  for (let t = 0; t < params.holdTime / 2; t += FIXED_DT) {
    checkParking(state.check, parked, car, powertrain, false, runtime.targetBox, params)
    stepParking(state, params, FIXED_DT)
  }
  check(!state.done, 'meio segundo parado ainda nao e estacionar')
  check(state.progress > 0.3, `mas conta como progresso (${state.progress.toFixed(2)})`)

  // The rest of it is.
  for (let t = 0; t < params.holdTime; t += FIXED_DT) {
    checkParking(state.check, parked, car, powertrain, false, runtime.targetBox, params)
    stepParking(state, params, FIXED_DT)
  }
  check(state.done, 'o tempo completo estaciona o carro')

  // Driving through the right place at speed never validates, however long
  // the car spends inside the bay.
  const passing = createVehicleState(definition.target.x, definition.target.y, definition.target.angle)
  passing.vx = 4
  const rolling = createParkingState()
  for (let t = 0; t < 5; t += FIXED_DT) {
    checkParking(rolling.check, passing, car, powertrain, false, runtime.targetBox, params)
    stepParking(rolling, params, FIXED_DT)
  }
  check(!rolling.done, 'passar rapido pela vaga nao valida')
  check(!rolling.check.stopped, 'porque o carro nao esta parado')

  // Left in gear with the handbrake off, a car is not parked either.
  const inGear = createPowertrainState('manual', car.powertrain.idleRpm)
  inGear.gear = 1
  const loose = createParkingState()
  for (let t = 0; t < params.holdTime * 2; t += FIXED_DT) {
    checkParking(loose.check, parked, car, inGear, false, runtime.targetBox, params)
    stepParking(loose, params, FIXED_DT)
  }
  check(!loose.done, 'em marcha e sem freio de mao nao valida')
  check(loose.check.centred && loose.check.stopped, 'ainda que esteja no lugar e parado')

  // The handbrake alone is enough, which is what a driver actually does.
  const held = createParkingState()
  for (let t = 0; t < params.holdTime * 1.2; t += FIXED_DT) {
    checkParking(held.check, parked, car, inGear, true, runtime.targetBox, params)
    stepParking(held, params, FIXED_DT)
  }
  check(held.done, 'o freio de mao sozinho vale')

  // Nose sticking out of the bay: the centre may be inside and the wheels not.
  const crooked = createVehicleState(
    definition.target.x + Math.cos(definition.target.angle) * 2.0,
    definition.target.y + Math.sin(definition.target.angle) * 2.0,
    definition.target.angle,
  )
  const out = checkParking(
    createParkingCheck(),
    crooked,
    car,
    powertrain,
    false,
    runtime.targetBox,
    params,
  )
  check(!out.satisfied, 'com o carro para fora da vaga nao valida')
  check(!out.wheelsInside, 'porque as rodas sairam do poligono')

  // And crooked inside it fails on the angle rather than on the position.
  const askew = createVehicleState(
    definition.target.x,
    definition.target.y,
    definition.target.angle + (25 * Math.PI) / 180,
  )
  const angled = checkParking(
    createParkingCheck(),
    askew,
    car,
    powertrain,
    false,
    runtime.targetBox,
    params,
  )
  check(!angled.aligned, `25 graus torto nao alinha (${radToDeg(angled.angleError).toFixed(1)})`)

  // Reversed into the bay is parked: no car park has ever cared which way
  // round a car is standing.
  const backwards = createVehicleState(
    definition.target.x,
    definition.target.y,
    definition.target.angle + Math.PI,
  )
  const reversed = checkParking(
    createParkingCheck(),
    backwards,
    car,
    powertrain,
    false,
    runtime.targetBox,
    params,
  )
  check(reversed.satisfied, 'de re na vaga tambem esta estacionado')
}

// ------------------------------------------------------- driving into a wall

section('o carro nao sai da area')
{
  const definition = definitions[0]
  const runtime = buildLevel(definition, assets)
  const bounds = definition.bounds
  if (bounds.kind !== 'retangulo') throw new Error('a fase 1 deveria ser retangular')

  const collider: VehicleCollider = {
    box: playerBox(0, 0, 0),
    mass: car.mass,
    inertia: car.yawInertia,
    restitution: 0.02,
    friction: 0.32,
  }
  const log = createDamageLog()
  const motion: ColliderMotion = { x: 0, y: 0, vx: 0, vy: 0, yaw: 0, yawRate: 0 }

  // Full throttle at the nearest wall for twelve seconds, in every direction.
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.9]) {
    const state: VehicleState = createVehicleState(definition.spawn.x, definition.spawn.y, yaw)
    const powertrain = createPowertrainState('automatic', car.powertrain.idleRpm)
    const telemetry = createTelemetry(powertrain)
    const input = createInputState()
    input.throttle = 1

    for (let i = 0; i < 12 / FIXED_DT; i++) {
      stepVehicle(state, car, powertrain, input, FIXED_DT, telemetry)
      const cos = Math.cos(state.yaw)
      const sin = Math.sin(state.yaw)
      motion.x = state.x
      motion.y = state.y
      motion.yaw = state.yaw
      motion.yawRate = state.yawRate
      motion.vx = state.vx * cos - state.vy * sin
      motion.vy = state.vx * sin + state.vy * cos
      resolveVehicleCollisions(runtime.world, collider, motion, log)
      state.x = motion.x
      state.y = motion.y
      state.yawRate = motion.yawRate
      state.vx = motion.vx * cos + motion.vy * sin
      state.vy = -motion.vx * sin + motion.vy * cos
    }

    // Inside the lot, allowing only the millimetre of overlap the response
    // leaves behind on purpose.
    const slack = 0.01
    check(
      state.x > bounds.x - slack &&
        state.x < bounds.x + bounds.width + slack &&
        state.y > bounds.y - slack &&
        state.y < bounds.y + bounds.height + slack,
      `a ${radToDeg(yaw).toFixed(0)} graus o carro continua dentro ` +
        `(${state.x.toFixed(2)}, ${state.y.toFixed(2)})`,
    )
    check(Math.abs(state.vx) < 12, 'e nao atravessa o muro a toda velocidade')
  }
  check(log.total > 0, 'bater no muro custa dano')
}

// ------------------------------------------------------- into a parked car

section('bater num carro parado')
{
  // Full throttle into a parked van, on empty asphalt so nothing else is in
  // the way. What has to happen is that the car stops against it: no bounce,
  // no rebound, no being thrown anywhere.
  const van = manifest.sprites['parked_van']
  const world = createWorld([
    { box: createObb(20, 0, van.lengthMeters, van.widthMeters, Math.PI / 2), kind: 'carro', label: 'parked_van' },
  ])

  const collider: VehicleCollider = {
    box: playerBox(0, 0, 0),
    mass: car.mass,
    inertia: car.yawInertia,
    restitution: 0.02,
    friction: 0.32,
  }
  const log = createDamageLog()
  const motion: ColliderMotion = { x: 0, y: 0, vx: 0, vy: 0, yaw: 0, yawRate: 0 }

  const state: VehicleState = createVehicleState(8, 0, 0)
  const powertrain = createPowertrainState('automatic', car.powertrain.idleRpm)
  const telemetry = createTelemetry(powertrain)
  const input = createInputState()
  input.throttle = 1

  let hit = false
  let fastest = 0
  let worstRebound = 0
  for (let i = 0; i < 8 / FIXED_DT; i++) {
    stepVehicle(state, car, powertrain, input, FIXED_DT, telemetry)
    const cos = Math.cos(state.yaw)
    const sin = Math.sin(state.yaw)
    motion.x = state.x
    motion.y = state.y
    motion.yaw = state.yaw
    motion.yawRate = state.yawRate
    motion.vx = state.vx * cos - state.vy * sin
    motion.vy = state.vx * sin + state.vy * cos
    resolveVehicleCollisions(world, collider, motion, log)
    state.x = motion.x
    state.y = motion.y
    state.yawRate = motion.yawRate
    state.vx = motion.vx * cos + motion.vy * sin
    state.vy = -motion.vx * sin + motion.vy * cos

    if (!hit) fastest = Math.max(fastest, state.vx)
    if (log.latest > 0) hit = true
    if (hit) worstRebound = Math.min(worstRebound, state.vx)
  }

  check(hit, `o carro alcanca a van a ${fastest.toFixed(1)} m/s`)
  check(log.count >= 1, `e conta o impacto (${log.count}x, ${log.total.toFixed(2)})`)
  check(log.count <= 3, `sem contar um impacto por quadro encostado (${log.count}x)`)
  check(worstRebound > -0.3, `sem ser arremessado de volta (${worstRebound.toFixed(3)} m/s)`)
  check(Math.abs(state.vx) < 0.5, `parado contra a van (${state.vx.toFixed(3)} m/s)`)
  check(
    deepestOverlap(world, playerBox(state.x, state.y, state.yaw)) < 0.01,
    'e por fora dela',
  )
  check(state.x < 20, 'sem atravessar a van')

  // And the thing the whole hitbox is for: rolling up to a parked car at
  // walking pace has to stop the bumper against it, not a hand's width short.
  // The van is turned across the lane, so its near face is one half-width in
  // front of its centre; the car's is one half-length ahead of its own.
  //
  // Twice: once at the pace somebody eases into a space, and once slower than
  // the floor an impact is logged at, which is what "just touching" means.
  for (const approach of [0.4, 0.1]) {
    const gentle = createDamageLog()
    const creep: ColliderMotion = { x: 16, y: 0, vx: approach, vy: 0, yaw: 0, yawRate: 0 }
    for (let i = 0; i < 30 / FIXED_DT; i++) {
      creep.x += creep.vx * FIXED_DT
      creep.y += creep.vy * FIXED_DT
      setObbPose(collider.box, creep.x, creep.y, creep.yaw)
      resolveVehicleCollisions(world, collider, creep, gentle)
      // Still on the throttle after the touch, as a driver leaning on a kerb
      // would be: the contact has to hold, not become a shove.
      creep.vx = Math.max(creep.vx, approach * 0.25)
    }

    const vanFace = 20 - van.widthMeters / 2
    const nose = creep.x + manifest.sprites['player_sedan'].lengthMeters / 2
    const gap = vanFace - nose
    check(gap >= -0.01, `a ${approach} m/s nao entra na van (${(gap * 100).toFixed(1)} cm)`)
    check(
      gap < 0.03,
      `a ${approach} m/s encosta a poucos centimetros (${(gap * 100).toFixed(1)} cm)`,
    )
    console.log(`  encostando a ${approach} m/s: para a ${(gap * 1000).toFixed(1)} mm da van`)
    // Under the floor nothing is logged at all; above it, one touch and not
    // one per frame of leaning on the thing.
    if (approach < 0.15) {
      check(gentle.total === 0, `a ${approach} m/s encostar nao custa lataria (${gentle.total.toFixed(3)})`)
    } else {
      check(gentle.count === 1, `a ${approach} m/s conta um toque so (${gentle.count}x)`)
    }
  }
}

// -------------------------------------------------------------- the phases

section('maquina de estados')
{
  const definition = definitions[0]
  const runtime = buildLevel(definition, assets)
  const flow = createFlowState()
  check(flow.phase === 'menu', 'o jogo comeca no menu')

  chooseLevel(flow, 0)
  check(flow.phase === 'carregando', 'escolher uma fase pede o carregamento')
  levelReady(flow, runtime)
  check(flow.phase === 'jogando', 'com a fase pronta, o jogo roda')

  pauseRun(flow)
  check(flow.phase === 'pausado', 'da para pausar')
  advanceRun(flow, definition, false, 10)
  check(flow.run.time === 0, 'e o relogio nao anda pausado')
  resumeRun(flow)
  advanceRun(flow, definition, false, 1)
  check(Math.abs(flow.run.time - 1) < 1e-9, 'voltando a rodar, ele anda')

  // A stall is the moment the engine dies, not every frame it is dead.
  advanceRun(flow, definition, true, 1)
  advanceRun(flow, definition, true, 1)
  advanceRun(flow, definition, false, 1)
  advanceRun(flow, definition, true, 1)
  check(flow.run.stalls === 2, `duas mortes contadas (${flow.run.stalls})`)

  // Level one has no clock and no damage limit, so it cannot be lost.
  advanceRun(flow, definition, false, 10_000)
  check(flow.phase === 'jogando', 'uma fase sem limites nunca falha por tempo')

  // The one with a clock can be.
  const timed = definitions[3]
  const timedFlow = createFlowState()
  chooseLevel(timedFlow, 3)
  levelReady(timedFlow, buildLevel(timed, assets))
  advanceRun(timedFlow, timed, false, (timed.params.timeLimit ?? 0) + 1)
  check(timedFlow.phase === 'falhou' && timedFlow.failure === 'tempo', 'o tempo esgota a fase')

  // And by damage, which is the other limit.
  const rough = createFlowState()
  chooseLevel(rough, 3)
  levelReady(rough, buildLevel(timed, assets))
  rough.run.damage.total = (timed.params.damageLimit ?? 0) + 1
  advanceRun(rough, timed, false, 1)
  check(rough.phase === 'falhou' && rough.failure === 'dano', 'o dano tambem')

  // Finishing files a record and the record survives into the next attempt.
  const won = createFlowState()
  chooseLevel(won, 0)
  levelReady(won, runtime)
  advanceRun(won, definition, false, definition.params.targetTime)
  won.run.parking.check.distance = 0.05
  won.run.parking.check.angleError = 0.01
  completeRun(won, definition)
  check(won.phase === 'concluido', 'estacionar conclui a fase')
  check(won.result !== null && won.result.score.stars === 3, 'com tres estrelas')
  check(won.progress[definition.id]?.stars === 3, 'e o resultado fica guardado')

  leaveToMenu(won)
  check(won.phase === 'menu' && won.runtime === null, 'sair volta para a lista')
  check(won.progress[definition.id]?.stars === 3, 'sem perder o recorde')
}

// ---------------------------------------------------------------- scoring

section('nota e recordes')
{
  const params = definitions[1].params
  const perfect = scoreRun(
    { time: params.targetTime, damage: 0, stalls: 0, distance: 0, angleError: 0 },
    params,
  )
  check(perfect.points === 100, `um run perfeito vale 100 (${perfect.points})`)
  check(perfect.stars === 3, 'e tres estrelas')

  const rough = scoreRun(
    {
      time: params.targetTime * 3,
      damage: 40,
      stalls: 9,
      distance: params.centerTolerance,
      angleError: params.angleTolerance,
    },
    params,
  )
  check(rough.points === 0, `tudo errado vale 0 (${rough.points})`)
  check(rough.stars === 1, 'e ainda assim uma estrela: a vaga foi conquistada')

  const quick = scoreRun(
    { time: params.targetTime / 2, damage: 0, stalls: 0, distance: 0, angleError: 0 },
    params,
  )
  check(quick.points === 100, 'ser mais rapido que o alvo nao rende pontos extras')

  // The rule the criteria exist to keep, on every level that ships: inside the
  // target time, no damage, no stall, and parked anywhere the bay accepts is
  // three stars. Taken at the very edge of both tolerances, which is the case
  // the old arithmetic marked down to two -- a park the game had just called
  // good enough, costing the whole precision weight for being it.
  for (const definition of definitions) {
    const p = definition.params
    const edge = scoreRun(
      {
        time: p.targetTime,
        damage: 0,
        stalls: 0,
        distance: p.centerTolerance,
        angleError: p.angleTolerance,
      },
      p,
    )
    check(edge.stars === 3, `${definition.id}: run limpo na borda da tolerancia da tres estrelas`)
    check(
      edge.criteria.every((criterion) => criterion.passed),
      `${definition.id}: e com os quatro criterios cumpridos`,
    )
  }

  // Every criterion says what it measured and what it was measured against,
  // because a verdict with no numbers behind it cannot be argued with or
  // improved on.
  const missed = scoreRun(
    {
      time: params.targetTime * 1.5,
      damage: 2,
      stalls: 1,
      distance: params.centerTolerance * 0.5,
      angleError: params.angleTolerance * 0.5,
    },
    params,
  )
  check(missed.stars < 3, 'estourar o tempo com dano e motor morto nao da tres estrelas')
  check(missed.criteria.length === 4, 'quatro criterios na tela')
  check(
    missed.criteria.filter((criterion) => criterion.passed).map((c) => c.id).join(',') === 'precisao',
    'e so a precisao passou',
  )
  check(
    missed.criteria.every((criterion) => criterion.detail.includes('/')),
    'cada criterio mostra o valor obtido e o limiar',
  )

  // A stall counted that never happened would take the star with it, so the
  // criterion has to read zero when the engine never died.
  const alive = scoreRun(
    { time: params.targetTime, damage: 0, stalls: 0, distance: 0, angleError: 0 },
    params,
  )
  const stallCriterion = alive.criteria.find((criterion) => criterion.id === 'motor')
  check(stallCriterion?.detail === '0 / 0', `sem morrer o motor conta zero (${stallCriterion?.detail})`)

  const base: LevelRecord = { stars: 2, points: 70, time: 40, damage: 1 }
  check(isBetter({ ...base, stars: 3, points: 60 }, base), 'mais estrelas e melhor')
  check(isBetter({ ...base, points: 71 }, base), 'mais pontos e melhor')
  check(isBetter({ ...base, time: 30 }, base), 'com tudo igual, mais rapido e melhor')
  check(!isBetter({ ...base, time: 50 }, base), 'mais devagar nao e melhor')
  check(isBetter(base, undefined), 'qualquer resultado bate um nao existente')
}

if (failures > 0) {
  console.log(`\n${failures} verificacao(oes) falharam`)
  throw new Error(`${failures} verificacao(oes) falharam`)
}
console.log('\ntodas as verificacoes passaram')
