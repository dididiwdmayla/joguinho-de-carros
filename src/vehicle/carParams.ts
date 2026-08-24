/**
 * Car definitions are data, never code: adding a second car means adding a
 * JSON file, not touching a formula. No physical number is hardcoded here.
 */

/** One point of the engine's wide-open-throttle torque curve. */
export interface TorquePoint {
  /** Crankshaft speed [rpm]. */
  readonly rpm: number
  /** Torque at full throttle [N*m]. */
  readonly torque: number
}

export interface PowertrainParams {
  /** Full-throttle torque, interpolated linearly between the points. */
  readonly torqueCurve: readonly TorquePoint[]
  /** Speed the idle governor holds with the clutch open [rpm]. */
  readonly idleRpm: number
  /** Below this, a loaded engine dies [rpm]. */
  readonly stallRpm: number
  /**
   * Added to `stallRpm` while the engine is stone cold, fading out as it warms
   * [rpm]. Zero on an engine that does not care.
   */
  readonly coldStallBonus: number
  /** How long a cold engine takes to reach working temperature at idle [s]. */
  readonly warmupTime: number
  /** Rev limiter [rpm]. */
  readonly maxRpm: number
  /** Rotating inertia of the crankshaft and flywheel [kg*m^2]. */
  readonly engineInertia: number
  /** Overrun braking torque per rpm with the throttle closed [N*m/rpm]. */
  readonly engineBraking: number
  /** Clutch torque per rpm of slip between the two plates [N*m/rpm]. */
  readonly clutchStiffness: number
  /** Torque the clutch can hold when fully clamped [N*m]. */
  readonly clutchMaxTorque: number
  /** How fast the pedal goes down while the control is held [1/s]. */
  readonly clutchPressRate: number
  /** How fast the pedal comes back up once it is released [1/s]. */
  readonly clutchReleaseRate: number
  /**
   * Rolling radius of the driven wheels [m]. Deliberately independent of
   * `wheelDiameter`, which is art: the sprite's tyres are drawn smaller so they
   * fit under the body, and the gearing must not follow the drawing.
   */
  readonly wheelRadius: number
  /** Rotating inertia of the driven wheels and half-shafts [kg*m^2]. */
  readonly wheelInertia: number
  /** Rotating inertia on the gearbox input side [kg*m^2]. */
  readonly drivelineInertia: number
  /** Forward gear ratios, first to top. */
  readonly gearRatios: readonly number[]
  /** Reverse ratio; negative, so the same formulas run the car backwards. */
  readonly reverseRatio: number
  /** Final drive (differential) ratio. */
  readonly finalDrive: number
  /** Automatic mode shifts up above this [rpm]. */
  readonly upshiftRpm: number
  /** Automatic mode shifts down below this [rpm]. */
  readonly downshiftRpm: number
  /** Torque cut of an automatic shift [s]. */
  readonly automaticShiftTime: number
  /** Torque cut of a sequential shift [s]. */
  readonly sequentialShiftTime: number
  /** How long the starter takes to bring the engine back to idle [s]. */
  readonly starterTime: number
  /**
   * Gearbox input speed at which the two clutchless modes have their clutch all
   * the way out and drive the car through a solid coupling [rpm].
   */
  readonly autoEngageRpm: number
  /** Engine speed the clutchless modes hold on a full-throttle launch [rpm]. */
  readonly autoLaunchRpm: number
}

export interface CarParams {
  /** Total mass [kg]. */
  readonly mass: number
  /** Declared axle-to-axle distance [m]. */
  readonly wheelbase: number
  /** Distance from the centre of gravity to the front axle, "a" [m]. */
  readonly cgToFront: number
  /** Distance from the centre of gravity to the rear axle, "b" [m]. */
  readonly cgToRear: number
  /** Height of the centre of gravity above the ground, "h" [m]. */
  readonly cgHeight: number
  /** Front axle cornering stiffness [N/rad]. */
  readonly corneringStiffnessFront: number
  /** Rear axle cornering stiffness [N/rad]. */
  readonly corneringStiffnessRear: number
  /** Tyre/road friction coefficient [-]. */
  readonly mu: number
  /** Steering lock [rad]. */
  readonly maxSteerAngle: number
  /** How fast the front wheels can turn [rad/s]. */
  readonly steerRate: number
  /** Peak longitudinal force from the brakes [N]. */
  readonly maxBrakeForce: number
  /** Aerodynamic drag factor, force = k*v^2 [N/(m/s)^2]. */
  readonly dragCoefficient: number
  /** Rolling resistance factor, force = k*v [N/(m/s)]. */
  readonly rollingResistance: number
  /** Body length [m]. */
  readonly length: number
  /** Body width [m]. */
  readonly width: number
  /** Tyre width [m]. */
  readonly wheelWidth: number
  /** Tyre diameter [m], the footprint's length along the rolling direction. */
  readonly wheelDiameter: number
  /** Distance between the centres of the left and right tyres [m]. */
  readonly trackWidth: number
  /** Art path, resolved against the asset manifest. */
  readonly sprite: string
  /** Engine, clutch and gearbox. */
  readonly powertrain: PowertrainParams

  /**
   * Yaw moment of inertia [kg*m^2], derived rather than authored: a uniform
   * rectangular plate of the body's own footprint, Iz = m*(L^2 + W^2)/12.
   * For the sedan that lands around 2640 kg*m^2, right where a real sedan is.
   */
  readonly yawInertia: number
  /** Effective wheelbase used by the model, L = a + b [m]. */
  readonly axleSpan: number
}

const NUMERIC_FIELDS = [
  'mass',
  'wheelbase',
  'cgToFront',
  'cgToRear',
  'cgHeight',
  'corneringStiffnessFront',
  'corneringStiffnessRear',
  'mu',
  'maxSteerAngle',
  'steerRate',
  'maxBrakeForce',
  'dragCoefficient',
  'rollingResistance',
  'length',
  'width',
  'wheelWidth',
  'wheelDiameter',
  'trackWidth',
] as const

type NumericField = (typeof NUMERIC_FIELDS)[number]

/** Every powertrain number that must be present and strictly positive. */
const POWERTRAIN_FIELDS = [
  'idleRpm',
  'stallRpm',
  'maxRpm',
  'warmupTime',
  'engineInertia',
  'engineBraking',
  'clutchStiffness',
  'clutchMaxTorque',
  'clutchPressRate',
  'clutchReleaseRate',
  'wheelRadius',
  'wheelInertia',
  'drivelineInertia',
  'finalDrive',
  'upshiftRpm',
  'downshiftRpm',
  'automaticShiftTime',
  'sequentialShiftTime',
  'starterTime',
  'autoEngageRpm',
  'autoLaunchRpm',
] as const

type PowertrainField = (typeof POWERTRAIN_FIELDS)[number]

function readObject(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${where}: deve ser um objeto`)
  }
  return raw as Record<string, unknown>
}

function readPositive(source: Record<string, unknown>, field: string, where: string): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${where}: "${field}" deve ser um numero positivo`)
  }
  return value
}

/** Same, for a number that is allowed to be zero: a bonus, an offset. */
function readNonNegative(source: Record<string, unknown>, field: string, where: string): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${where}: "${field}" deve ser um numero maior ou igual a zero`)
  }
  return value
}

/** The curve is a list of [rpm, torque] pairs, ordered by rising rpm. */
function parseTorqueCurve(raw: unknown, where: string): TorquePoint[] {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error(`${where}: "torqueCurve" precisa de ao menos 2 pontos`)
  }
  const points: TorquePoint[] = []
  for (let i = 0; i < raw.length; i++) {
    const pair: unknown = raw[i]
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error(`${where}: "torqueCurve[${i}]" deve ser um par [rpm, torque]`)
    }
    const rpm: unknown = pair[0]
    const torque: unknown = pair[1]
    if (typeof rpm !== 'number' || !Number.isFinite(rpm) || rpm < 0) {
      throw new Error(`${where}: "torqueCurve[${i}]" tem rpm invalido`)
    }
    if (typeof torque !== 'number' || !Number.isFinite(torque)) {
      throw new Error(`${where}: "torqueCurve[${i}]" tem torque invalido`)
    }
    if (i > 0 && rpm <= points[i - 1].rpm) {
      throw new Error(`${where}: "torqueCurve" precisa estar em rpm crescente`)
    }
    points.push({ rpm, torque })
  }
  return points
}

function parseGearRatios(raw: unknown, where: string): number[] {
  if (!Array.isArray(raw) || raw.length < 1) {
    throw new Error(`${where}: "gearRatios" precisa de ao menos uma marcha`)
  }
  const ratios: number[] = []
  for (let i = 0; i < raw.length; i++) {
    const ratio: unknown = raw[i]
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) {
      throw new Error(`${where}: "gearRatios[${i}]" deve ser um numero positivo`)
    }
    if (i > 0 && ratio >= ratios[i - 1]) {
      throw new Error(`${where}: "gearRatios" precisa estar em ordem decrescente`)
    }
    ratios.push(ratio)
  }
  return ratios
}

function parsePowertrain(raw: unknown, where: string): PowertrainParams {
  const source = readObject(raw, `${where}: "powertrain"`)
  const numbers = {} as Record<PowertrainField, number>
  for (const field of POWERTRAIN_FIELDS) {
    numbers[field] = readPositive(source, field, `${where}.powertrain`)
  }

  const reverseRatio = source['reverseRatio']
  if (typeof reverseRatio !== 'number' || !Number.isFinite(reverseRatio) || reverseRatio >= 0) {
    throw new Error(`${where}.powertrain: "reverseRatio" deve ser negativo`)
  }

  const powertrain: PowertrainParams = {
    ...numbers,
    reverseRatio,
    coldStallBonus: readNonNegative(source, 'coldStallBonus', `${where}.powertrain`),
    torqueCurve: parseTorqueCurve(source['torqueCurve'], `${where}.powertrain`),
    gearRatios: parseGearRatios(source['gearRatios'], `${where}.powertrain`),
  }

  validatePowertrain(powertrain, `${where}.powertrain`)
  return powertrain
}

/**
 * The rules an engine has to obey whoever wrote its numbers -- the JSON on
 * disk, or a fuel type overwriting some of them. Kept in one place precisely
 * because there is now more than one way to arrive at a set of them.
 */
export function validatePowertrain(powertrain: PowertrainParams, where: string): void {
  if (powertrain.stallRpm >= powertrain.idleRpm) {
    throw new Error(`${where}: "stallRpm" precisa ser menor que "idleRpm"`)
  }
  // A cold engine that cannot hold its own idle would die the moment a gear
  // went in, every time, and no amount of clutch control would save it.
  if (powertrain.stallRpm + powertrain.coldStallBonus >= powertrain.idleRpm) {
    throw new Error(`${where}: "stallRpm" + "coldStallBonus" precisa ser menor que "idleRpm"`)
  }
  if (powertrain.downshiftRpm >= powertrain.upshiftRpm) {
    throw new Error(`${where}: "downshiftRpm" precisa ser menor que "upshiftRpm"`)
  }
  if (powertrain.upshiftRpm >= powertrain.maxRpm) {
    throw new Error(`${where}: "upshiftRpm" precisa ser menor que "maxRpm"`)
  }
}

function parseCarParams(raw: unknown, where: string): CarParams {
  const source = readObject(raw, `${where}: raiz`)

  const numbers = {} as Record<NumericField, number>
  for (const field of NUMERIC_FIELDS) {
    numbers[field] = readPositive(source, field, where)
  }

  const sprite = source['sprite']
  if (typeof sprite !== 'string' || sprite.length === 0) {
    throw new Error(`${where}: "sprite" deve ser uma string nao vazia`)
  }

  const axleSpan = numbers.cgToFront + numbers.cgToRear
  if (Math.abs(axleSpan - numbers.wheelbase) > 1e-3) {
    console.warn(
      `${where}: cgToFront + cgToRear (${axleSpan.toFixed(3)} m) nao bate com wheelbase ` +
        `(${numbers.wheelbase.toFixed(3)} m); a fisica usa a soma.`,
    )
  }

  return {
    ...numbers,
    sprite,
    powertrain: parsePowertrain(source['powertrain'], where),
    axleSpan,
    yawInertia: (numbers.mass * (numbers.length * numbers.length + numbers.width * numbers.width)) / 12,
  }
}

export async function loadCarParams(url: string, where: string): Promise<CarParams> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Falha ao carregar ${where} (HTTP ${response.status})`)
  return parseCarParams((await response.json()) as unknown, where)
}
