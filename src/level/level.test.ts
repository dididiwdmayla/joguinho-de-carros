/**
 * Collision, level and parking checks, run with `npm test`.
 *
 * No framework and no dependency: every expectation goes through `check`, and
 * a run with any failed expectation throws at the end, which is a non-zero
 * exit code for whatever is calling it.
 *
 * Three things are being proved here. That the separating axis test and the
 * response do what a car hitting scenery should do -- stop without bouncing,
 * slide along a wall taken at a shallow angle, never end up outside the lot.
 * That parking means what the brief says it means, hold included. And that
 * every level that ships can actually be driven: the spawn is clear, the bay
 * is clear, and there is a way in and out of it wide enough for the car.
 */
import manifestJson from '../data/assets.json' with { type: 'json' }
import sedanJson from '../data/cars/player_sedan.json' with { type: 'json' }
import level01 from '../data/levels/01-vaga-isolada.json' with { type: 'json' }
import level02 from '../data/levels/02-entre-dois-carros.json' with { type: 'json' }
import level03 from '../data/levels/03-baliza-tranquila.json' with { type: 'json' }
import level04 from '../data/levels/04-van-e-pickup.json' with { type: 'json' }
import level05 from '../data/levels/05-baliza-apertada.json' with { type: 'json' }

import type { AssetManifest } from '../assets/manifest'
import type { AssetStore, LoadedSprite } from '../assets/loader'
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
import { radToDeg } from '../core/math'
import { COLLISION_MARGIN } from '../game/state'
import { isBetter, type LevelRecord } from '../game/progress'
import { createInputState } from '../input/input'
import { parseCarParams, type CarParams } from '../vehicle/carParams'
import { createTelemetry, stepVehicle } from '../vehicle/physics'
import { createPowertrainState, NEUTRAL_GEAR } from '../vehicle/powertrain'
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

/** The car's box, five per cent inside the sprite, as the game builds it. */
function playerBox(x: number, y: number, yaw: number): Obb {
  const sprite = manifest.sprites['player_sedan']
  return createObb(
    x,
    y,
    sprite.lengthMeters * (1 - COLLISION_MARGIN),
    sprite.widthMeters * (1 - COLLISION_MARGIN),
    yaw,
  )
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
