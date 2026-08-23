/**
 * Car definitions are data, never code: adding a second car means adding a
 * JSON file, not touching a formula. No physical number is hardcoded here.
 */

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
  /** Peak longitudinal force from the throttle [N]. */
  readonly maxDriveForce: number
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
  /** Art path, resolved against the asset manifest. */
  readonly sprite: string

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
  'maxDriveForce',
  'maxBrakeForce',
  'dragCoefficient',
  'rollingResistance',
  'length',
  'width',
] as const

type NumericField = (typeof NUMERIC_FIELDS)[number]

function parseCarParams(raw: unknown, where: string): CarParams {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${where}: raiz deve ser um objeto`)
  }
  const source = raw as Record<string, unknown>

  const numbers = {} as Record<NumericField, number>
  for (const field of NUMERIC_FIELDS) {
    const value = source[field]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`${where}: "${field}" deve ser um numero positivo`)
    }
    numbers[field] = value
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
    axleSpan,
    yawInertia: (numbers.mass * (numbers.length * numbers.length + numbers.width * numbers.width)) / 12,
  }
}

export async function loadCarParams(url: string, where: string): Promise<CarParams> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Falha ao carregar ${where} (HTTP ${response.status})`)
  return parseCarParams((await response.json()) as unknown, where)
}
