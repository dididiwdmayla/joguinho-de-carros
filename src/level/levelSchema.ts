/**
 * The level file format, and the parser that refuses anything else.
 *
 * A level is data, exactly like a car or a fuel: five files under
 * src/data/levels describe five car parks, and nothing about them is written
 * in code. The rule the rest of the project already follows holds here too --
 * every number a player can feel comes from a file they can open.
 *
 * Angles are authored in degrees, because nobody lays out a car park in
 * radians, and converted here once. Everything else is metres and seconds.
 */
import type { AssetManifest } from '../assets/manifest'

/** Rotation and position of something placed in the world. */
export interface Pose {
  readonly x: number
  readonly y: number
  /** Heading [rad], converted from the degrees in the file. */
  readonly angle: number
}

export interface GroundDefinition {
  /** Manifest key of the tile the lot is paved with. */
  readonly tile: string
  /** Paved rectangle, in metres. Outside it there is no lot. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The playable area: a rectangle, or a polygon for anything else. */
export type BoundsDefinition =
  | { readonly kind: 'retangulo'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: 'poligono'; readonly points: readonly (readonly [number, number])[] }

export type SlotStyle = 'perpendicular' | 'paralela'

export interface SlotDefinition extends Pose {
  /** Extent along the slot's own +X axis, the direction a parked car faces [m]. */
  readonly length: number
  /** Extent across it [m]. */
  readonly width: number
  readonly style: SlotStyle
  /** Manifest key of the car standing in it, or null for an empty bay. */
  readonly occupant: string | null
}

export interface ObstacleDefinition extends Pose {
  /** Manifest key: the sprite is also where the box's size comes from. */
  readonly type: string
}

export interface DecalDefinition extends Pose {
  readonly type: string
  /** Multiplies the manifest size; 1 draws it at its declared metres. */
  readonly scale: number
}

/** How a run is scored once the car is in the bay. */
export interface ScoreParams {
  /** Points lost for taking twice the target time. */
  readonly timeWeight: number
  /** Points lost for `damageReference` worth of impacts. */
  readonly damageWeight: number
  readonly damageReference: number
  /** Points lost for `stallReference` stalls. */
  readonly stallWeight: number
  readonly stallReference: number
  /** Points lost for finishing at the very edge of the centre tolerance. */
  readonly distanceWeight: number
  /** Points lost for finishing at the very edge of the angle tolerance. */
  readonly angleWeight: number
  /** Score needed for the third and the second star. */
  readonly threeStars: number
  readonly twoStars: number
}

export interface LevelParams {
  /** What a clean run should take [s]; the clock is scored against it. */
  readonly targetTime: number
  /** Run lost past this [s], or null for a level with no clock. */
  readonly timeLimit: number | null
  /** Run lost past this much accumulated impact [m/s], or null. */
  readonly damageLimit: number | null
  /** How far the car's centre may sit from the bay's [m]. */
  readonly centerTolerance: number
  /** How far off the bay's axis the car may be [rad]. */
  readonly angleTolerance: number
  /** Speed under which the car counts as stopped [m/s]. */
  readonly stopSpeed: number
  /** How long every condition has to hold at once before the bay is won [s]. */
  readonly holdTime: number
  readonly score: ScoreParams
}

export interface LevelDefinition {
  readonly id: string
  readonly name: string
  /** 1..5, shown on the level card. Nothing reads it but the menu. */
  readonly difficulty: number
  /** Seeds every random choice the level makes, so it looks the same always. */
  readonly seed: number
  readonly ground: GroundDefinition
  readonly bounds: BoundsDefinition
  readonly spawn: Pose
  readonly target: SlotDefinition
  readonly slots: readonly SlotDefinition[]
  readonly obstacles: readonly ObstacleDefinition[]
  readonly decals: readonly DecalDefinition[]
  readonly params: LevelParams
}

const DEG_TO_RAD = Math.PI / 180

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readObject(source: Record<string, unknown>, field: string, where: string): Record<string, unknown> {
  const value = source[field]
  if (!isRecord(value)) throw new Error(`${where}: "${field}" deve ser um objeto`)
  return value
}

function readString(source: Record<string, unknown>, field: string, where: string): string {
  const value = source[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where}: "${field}" deve ser uma string nao vazia`)
  }
  return value
}

function readNumber(source: Record<string, unknown>, field: string, where: string): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${where}: "${field}" deve ser um numero`)
  }
  return value
}

function readPositive(source: Record<string, unknown>, field: string, where: string): number {
  const value = readNumber(source, field, where)
  if (value <= 0) throw new Error(`${where}: "${field}" deve ser maior que zero`)
  return value
}

function readNonNegative(source: Record<string, unknown>, field: string, where: string): number {
  const value = readNumber(source, field, where)
  if (value < 0) throw new Error(`${where}: "${field}" nao pode ser negativo`)
  return value
}

/** A limit a level is allowed to switch off by writing null. */
function readOptionalPositive(
  source: Record<string, unknown>,
  field: string,
  where: string,
): number | null {
  const value = source[field]
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${where}: "${field}" deve ser um numero positivo ou null`)
  }
  return value
}

/** Angles are written in degrees and land here as radians. */
function readAngle(source: Record<string, unknown>, where: string): number {
  const value = source['angulo']
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${where}: "angulo" deve ser um numero em graus`)
  }
  return value * DEG_TO_RAD
}

function readPose(source: Record<string, unknown>, where: string): Pose {
  return { x: readNumber(source, 'x', where), y: readNumber(source, 'y', where), angle: readAngle(source, where) }
}

function readArray(source: Record<string, unknown>, field: string, where: string): unknown[] {
  const value = source[field]
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${where}: "${field}" deve ser uma lista`)
  return value
}

function parseGround(raw: Record<string, unknown>, where: string): GroundDefinition {
  return {
    tile: readString(raw, 'tile', where),
    x: readNumber(raw, 'x', where),
    y: readNumber(raw, 'y', where),
    width: readPositive(raw, 'largura', where),
    height: readPositive(raw, 'altura', where),
  }
}

function parseBounds(raw: Record<string, unknown>, where: string): BoundsDefinition {
  const kind = readString(raw, 'tipo', where)
  if (kind === 'retangulo') {
    return {
      kind: 'retangulo',
      x: readNumber(raw, 'x', where),
      y: readNumber(raw, 'y', where),
      width: readPositive(raw, 'largura', where),
      height: readPositive(raw, 'altura', where),
    }
  }
  if (kind === 'poligono') {
    const raws = readArray(raw, 'pontos', where)
    if (raws.length < 3) throw new Error(`${where}: "pontos" precisa de ao menos 3 vertices`)
    const points = raws.map((point, index) => {
      if (!Array.isArray(point) || point.length !== 2) {
        throw new Error(`${where}: "pontos[${index}]" deve ser um par [x, y]`)
      }
      const [x, y] = point as unknown[]
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`${where}: "pontos[${index}]" tem coordenada invalida`)
      }
      return [x, y] as const
    })
    return { kind: 'poligono', points }
  }
  throw new Error(`${where}: "tipo" deve ser "retangulo" ou "poligono"`)
}

function parseSlot(raw: unknown, where: string): SlotDefinition {
  if (!isRecord(raw)) throw new Error(`${where}: deve ser um objeto`)
  const style = raw['tipo'] === undefined ? 'perpendicular' : readString(raw, 'tipo', where)
  if (style !== 'perpendicular' && style !== 'paralela') {
    throw new Error(`${where}: "tipo" deve ser "perpendicular" ou "paralela"`)
  }
  const occupant = raw['ocupante']
  if (occupant !== undefined && occupant !== null && typeof occupant !== 'string') {
    throw new Error(`${where}: "ocupante" deve ser o nome de um sprite ou null`)
  }
  return {
    ...readPose(raw, where),
    length: readPositive(raw, 'comprimento', where),
    width: readPositive(raw, 'largura', where),
    style,
    occupant: typeof occupant === 'string' && occupant.length > 0 ? occupant : null,
  }
}

function parseObstacle(raw: unknown, where: string): ObstacleDefinition {
  if (!isRecord(raw)) throw new Error(`${where}: deve ser um objeto`)
  return { ...readPose(raw, where), type: readString(raw, 'tipo', where) }
}

function parseDecal(raw: unknown, where: string): DecalDefinition {
  if (!isRecord(raw)) throw new Error(`${where}: deve ser um objeto`)
  const scale = raw['escala']
  if (scale !== undefined && (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0)) {
    throw new Error(`${where}: "escala" deve ser um numero positivo`)
  }
  return {
    ...readPose(raw, where),
    type: readString(raw, 'tipo', where),
    scale: typeof scale === 'number' ? scale : 1,
  }
}

function parseScore(raw: Record<string, unknown>, where: string): ScoreParams {
  const score: ScoreParams = {
    timeWeight: readNonNegative(raw, 'pesoTempo', where),
    damageWeight: readNonNegative(raw, 'pesoDano', where),
    damageReference: readPositive(raw, 'danoReferencia', where),
    stallWeight: readNonNegative(raw, 'pesoMotorMorto', where),
    stallReference: readPositive(raw, 'motoresReferencia', where),
    distanceWeight: readNonNegative(raw, 'pesoDistancia', where),
    angleWeight: readNonNegative(raw, 'pesoAngulo', where),
    threeStars: readNonNegative(raw, 'tresEstrelas', where),
    twoStars: readNonNegative(raw, 'duasEstrelas', where),
  }
  if (score.twoStars >= score.threeStars) {
    throw new Error(`${where}: "duasEstrelas" precisa ser menor que "tresEstrelas"`)
  }
  return score
}

function parseParams(raw: Record<string, unknown>, where: string): LevelParams {
  const params: LevelParams = {
    targetTime: readPositive(raw, 'tempoAlvo', where),
    timeLimit: readOptionalPositive(raw, 'tempoLimite', where),
    damageLimit: readOptionalPositive(raw, 'danoLimite', where),
    centerTolerance: readPositive(raw, 'toleranciaCentro', where),
    angleTolerance: readPositive(raw, 'toleranciaAngulo', where) * DEG_TO_RAD,
    stopSpeed: readPositive(raw, 'velocidadeParado', where),
    holdTime: readPositive(raw, 'tempoValidacao', where),
    score: parseScore(readObject(raw, 'pontuacao', where), `${where}.pontuacao`),
  }
  if (params.timeLimit !== null && params.timeLimit <= params.targetTime) {
    throw new Error(`${where}: "tempoLimite" precisa ser maior que "tempoAlvo"`)
  }
  return params
}

export function parseLevel(raw: unknown, where: string): LevelDefinition {
  if (!isRecord(raw)) throw new Error(`${where}: raiz deve ser um objeto`)

  const level: LevelDefinition = {
    id: readString(raw, 'id', where),
    name: readString(raw, 'nome', where),
    difficulty: readPositive(raw, 'dificuldade', where),
    seed: readNumber(raw, 'semente', where),
    ground: parseGround(readObject(raw, 'chao', where), `${where}.chao`),
    bounds: parseBounds(readObject(raw, 'limites', where), `${where}.limites`),
    spawn: readPose(readObject(raw, 'spawn', where), `${where}.spawn`),
    target: parseSlot(readObject(raw, 'vagaAlvo', where), `${where}.vagaAlvo`),
    slots: readArray(raw, 'vagas', where).map((slot, i) => parseSlot(slot, `${where}.vagas[${i}]`)),
    obstacles: readArray(raw, 'obstaculos', where).map((obstacle, i) =>
      parseObstacle(obstacle, `${where}.obstaculos[${i}]`),
    ),
    decals: readArray(raw, 'decais', where).map((decal, i) =>
      parseDecal(decal, `${where}.decais[${i}]`),
    ),
    params: parseParams(readObject(raw, 'parametros', where), `${where}.parametros`),
  }

  // The target bay is never occupied: a level that parks a car in the space
  // the player is being sent to is not hard, it is broken.
  if (level.target.occupant !== null) {
    throw new Error(`${where}.vagaAlvo: a vaga alvo nao pode estar ocupada`)
  }
  return level
}

/**
 * Every sprite a level needs. Checked against the manifest before anything is
 * fetched, so a typo in a level file says which level and which name rather
 * than failing later as a missing image.
 */
export function levelSpriteKeys(level: LevelDefinition): string[] {
  const keys = new Set<string>([level.ground.tile])
  for (const slot of [level.target, ...level.slots]) {
    if (slot.occupant !== null) keys.add(slot.occupant)
  }
  for (const obstacle of level.obstacles) keys.add(obstacle.type)
  for (const decal of level.decals) keys.add(decal.type)
  return [...keys]
}

/** Throws unless every sprite the level names exists in the manifest. */
export function validateLevelSprites(level: LevelDefinition, manifest: AssetManifest): void {
  for (const key of levelSpriteKeys(level)) {
    if (manifest.sprites[key] === undefined) {
      throw new Error(`fase "${level.id}": sprite "${key}" nao existe no manifesto`)
    }
  }
}
