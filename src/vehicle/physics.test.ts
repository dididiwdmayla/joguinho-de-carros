/**
 * Physics checks, run with `npm test`.
 *
 * No framework and no dependency: every expectation goes through `check`, and
 * a run with any failed expectation throws at the end, which is a non-zero
 * exit code for whatever is calling it.
 *
 * The first block is the one that matters. Every force a car in neutral feels
 * is dissipative -- tyres, brakes, drag, rolling resistance -- so its kinetic
 * energy may only ever fall. Anything that makes it rise is the model paying
 * the car out of nowhere, and no amount of tuning fixes that, only a different
 * model. The rest of the file is the behaviour that fix has to leave standing:
 * a slow manoeuvre that follows the kinematic car, a coast-down that reaches
 * zero, and a parked car that stays parked.
 */
import sedanJson from '../data/cars/player_sedan.json' with { type: 'json' }
import { FIXED_DT, GRAVITY } from '../core/constants'
import { radToDeg } from '../core/math'
import { createInputState, type InputState } from '../input/input'
import { parseCarParams, type CarParams } from './carParams'
import { createTelemetry, stepVehicle, type VehicleTelemetry } from './physics'
import { createPowertrainState, type PowertrainState } from './powertrain'
import { createVehicleState, type VehicleState } from './vehicleState'

const car: CarParams = parseCarParams(sedanJson, 'player_sedan.json')

let failures = 0

function check(passed: boolean, message: string): void {
  if (passed) return
  failures++
  console.log(`  FALHOU: ${message}`)
}

interface Rig {
  readonly state: VehicleState
  readonly powertrain: PowertrainState
  readonly telemetry: VehicleTelemetry
  readonly input: InputState
}

/** A sedan in neutral, engine idling, nothing pressed. */
function rig(): Rig {
  const powertrain = createPowertrainState('manual', car.powertrain.idleRpm)
  return {
    state: createVehicleState(0, 0, 0),
    powertrain,
    telemetry: createTelemetry(powertrain),
    input: createInputState(),
  }
}

function step(r: Rig): void {
  stepVehicle(r.state, car, r.powertrain, r.input, FIXED_DT, r.telemetry)
}

function run(r: Rig, seconds: number): void {
  const steps = Math.round(seconds / FIXED_DT)
  for (let i = 0; i < steps; i++) step(r)
}

/** Steering input that puts the wheels on full lock, already there. */
function lock(r: Rig, side: number): void {
  r.input.steer = side
  r.state.steer = side * car.maxSteerAngle
}

const KMH = 1 / 3.6

// ---------------------------------------------------------------------------
// 1. Energy never rises without drive
// ---------------------------------------------------------------------------

function energyNeverRises(): void {
  const speeds = [0, 0.05, 0.2, 0.5, 1, 1.9, 2, 2.1, 3, 5, 8, 14, 25]
  const lateral = [0, 0.5, -2]
  const spins = [0, 0.5, -1.5]
  const steers = [-1, -0.5, 0, 0.5, 1]
  const brakes = [0, 0.4]

  let cases = 0
  let worstRise = 0
  let worstCase = ''
  let drivenCases = 0

  for (const speed of speeds) {
    for (const direction of speed === 0 ? [1] : [1, -1]) {
      for (const vy of lateral) {
        for (const yawRate of spins) {
          for (const steer of steers) {
            for (const brake of brakes) {
              const r = rig()
              r.state.vx = speed * direction
              r.state.vy = vy
              r.state.yawRate = yawRate
              lock(r, steer)
              r.input.brake = brake
              cases++

              let previous = Infinity
              for (let i = 0; i < 240; i++) {
                step(r)
                if (r.telemetry.powertrain.driveForce !== 0) drivenCases++
                const energy = r.telemetry.kineticEnergy
                const rise = energy - previous
                if (previous !== Infinity && rise > worstRise) {
                  worstRise = rise
                  worstCase =
                    `vx=${(speed * direction).toFixed(2)} vy=${vy} r=${yawRate} ` +
                    `steer=${steer} freio=${brake} passo=${i}`
                }
                previous = energy
              }
            }
          }
        }
      }
    }
  }

  console.log(`  ${cases} casos, 4 s cada; maior subida de energia: ${worstRise.toExponential(3)} J`)
  check(drivenCases === 0, `powertrain aplicou tracao em ${drivenCases} passos de teste`)
  // Zero, not "small": the forces are all anti-parallel to the velocities they
  // act on, so any rise at all is a sign error or an unstable integration.
  check(worstRise <= 0, `energia subiu ${worstRise.toExponential(3)} J em ${worstCase}`)
}

// ---------------------------------------------------------------------------
// 2. A slow manoeuvre is the kinematic car
// ---------------------------------------------------------------------------

/** Below this the car is parking, not manoeuvring: 1 km/h. */
const MANOEUVRE_FLOOR = 1 * KMH

function slowManoeuvreIsKinematic(): void {
  let worstSlip = 0
  let worstSlipAt = ''
  let worstYaw = 0
  let worstYawAt = ''

  for (const kmh of [2, 3, 6]) {
    for (const side of [1, -1]) {
      for (const direction of [1, -1]) {
        const r = rig()
        r.state.vx = direction * kmh * KMH
        lock(r, side)
        run(r, 0.5) // let the turn establish itself

        // Then watch the whole coast down to walking pace, not one sample of
        // it: the model has to agree with the kinematic car at every speed on
        // the way, not at one lucky one.
        for (let i = 0; i < 3600 && Math.abs(r.state.vx) > MANOEUVRE_FLOOR; i++) {
          step(r)
          const where = `${kmh} km/h, lock ${side}, marcha ${direction > 0 ? 'D' : 'R'}`

          // In the kinematic car the front tyre points exactly where it
          // travels. The blend this replaced held vy at zero, which contradicts
          // its own geometry and invented some 18 degrees of front slip at full
          // lock -- and with it a brake that was never applied.
          const slip = Math.abs(radToDeg(r.telemetry.slipFront))
          if (slip > worstSlip) {
            worstSlip = slip
            worstSlipAt = where
          }

          // The centre of mass of a kinematic car does have lateral velocity:
          // the body turns about a centre out on the rear axle's line, so
          // vy = yawRate*b, and yawRate itself is vx*tan(steer)/L.
          const yawKinematic = (r.state.vx * Math.tan(r.state.steer)) / car.axleSpan
          const yawError = Math.abs(r.state.yawRate - yawKinematic) / Math.abs(yawKinematic)
          if (yawError > worstYaw) {
            worstYaw = yawError
            worstYawAt = where
          }
          const vyKinematic = yawKinematic * car.cgToRear
          check(
            Math.abs(r.state.vy - vyKinematic) < 0.03 * Math.abs(vyKinematic) + 1e-3,
            `vy fora do cinematico em ${where}: ${r.state.vy.toFixed(4)} vs ` +
              `${vyKinematic.toFixed(4)} m/s`,
          )
        }
      }
    }
  }

  console.log(
    `  entre ${(MANOEUVRE_FLOOR * 3.6).toFixed(0)} e 6 km/h em lock: ` +
      `slip dianteiro no maximo ${worstSlip.toFixed(2)} deg (${worstSlipAt}), ` +
      `yawRate no maximo ${(worstYaw * 100).toFixed(1)}% fora do cinematico (${worstYawAt})`,
  )
  check(worstSlip < 1, `slip dianteiro chegou a ${worstSlip.toFixed(2)} deg em ${worstSlipAt}`)
  // What is left is the yaw inertia lagging a car that is slowing down, not a
  // tyre fighting one: the lag is what it costs to spin the body down.
  check(worstYaw < 0.03, `yawRate ficou ${(worstYaw * 100).toFixed(1)}% fora em ${worstYawAt}`)
}

// ---------------------------------------------------------------------------
// 3. Steering in a slow manoeuvre costs the right amount of speed
// ---------------------------------------------------------------------------

function slowManoeuvreDrag(): void {
  // What the tyres cost before any steering: rolling resistance alone.
  const rolling = car.rollingResistanceCoefficient * GRAVITY // [m/s^2]

  const straight = rig()
  straight.state.vx = 3 * KMH
  run(straight, 1)

  const turning = rig()
  turning.state.vx = 3 * KMH
  lock(turning, 1)
  run(turning, 1)

  const settled = rig()
  settled.state.vx = 3 * KMH
  lock(settled, 1)
  run(settled, 1)
  const before = settled.state.vx
  run(settled, 0.5)
  const sustained = (before - settled.state.vx) / 0.5

  console.log(
    `  a 3 km/h por 1 s: reto perde ${((3 * KMH - straight.state.vx) * 3.6).toFixed(2)} km/h, ` +
      `em lock perde ${((3 * KMH - turning.state.vx) * 3.6).toFixed(2)} km/h; ` +
      `depois de estabelecida a curva, ${sustained.toFixed(3)} m/s2 contra ` +
      `${rolling.toFixed(3)} m/s2 de rolamento`,
  )

  // Steering still has to cost speed: the rotation and the lateral velocity a
  // turn needs are paid for out of the speed the car came in with, and the
  // front tyre scrubs while the body is coming round to the new heading.
  check(
    turning.state.vx < straight.state.vx - 0.01,
    `estercar em neutro nao tirou velocidade: ${turning.state.vx} vs ${straight.state.vx}`,
  )
  // But once the turn is established the tyres are rolling, not fighting, and
  // what is left is rolling resistance and very little else. The blend used to
  // leave a saturated front tyre dragging here, worth two to three times this.
  check(
    sustained < 1.5 * rolling,
    `frenagem sustentada em lock: ${sustained.toFixed(3)} m/s2 contra ` +
      `${rolling.toFixed(3)} m/s2 de rolamento`,
  )
}

// ---------------------------------------------------------------------------
// 4. A free-rolling car actually stops
// ---------------------------------------------------------------------------

function freeRollingStops(): void {
  for (const [kmh, limit] of [
    [3, 8],
    [30, 60],
  ] as const) {
    const r = rig()
    r.state.vx = kmh * KMH
    const start = r.state.x

    let stoppedAt = -1
    const steps = Math.round(limit / FIXED_DT)
    for (let i = 0; i < steps; i++) {
      step(r)
      if (r.state.vx === 0) {
        stoppedAt = i * FIXED_DT
        break
      }
    }
    check(stoppedAt >= 0, `carro a ${kmh} km/h nao parou em ${limit} s`)
    if (stoppedAt < 0) continue

    console.log(
      `  ${kmh} km/h em neutro: para em ${stoppedAt.toFixed(1)} s, ` +
        `${(r.state.x - start).toFixed(1)} m`,
    )
    // And stays stopped: static friction holds it, it does not creep back.
    run(r, 2)
    check(r.state.vx === 0, `carro voltou a andar depois de parar: ${r.state.vx} m/s`)
  }
}

// ---------------------------------------------------------------------------
// 5. Manoeuvring at 3 km/h is steady, and a parked car stays parked
// ---------------------------------------------------------------------------

function slowManoeuvreIsSteady(): void {
  const r = rig()
  r.state.vx = 3 * KMH
  lock(r, 1)
  run(r, 1.5)

  // No shivering: once settled the yaw rate follows the falling speed and
  // nothing else. Step to step it may only shrink, never bounce.
  let previous = Math.abs(r.state.yawRate)
  let worstBounce = 0
  for (let i = 0; i < 180; i++) {
    step(r)
    const now = Math.abs(r.state.yawRate)
    worstBounce = Math.max(worstBounce, now - previous)
    previous = now
  }
  console.log(`  tremor a 3 km/h: maior repique do yawRate ${worstBounce.toExponential(2)} rad/s`)
  check(worstBounce <= 1e-9, `yawRate repicou ${worstBounce.toExponential(3)} rad/s em manobra`)

  // Parked, wheels on full lock, nothing driving: a steered wheel on a stopped
  // car moves nothing and rotates nothing.
  const parked = rig()
  lock(parked, 1)
  run(parked, 2)
  check(parked.state.vx === 0, `carro parado andou: vx=${parked.state.vx}`)
  check(parked.state.vy === 0, `carro parado escorregou: vy=${parked.state.vy}`)
  check(parked.state.yawRate === 0, `carro parado girou: r=${parked.state.yawRate}`)
}

console.log('energia nunca sobe sem tracao')
energyNeverRises()
console.log('manobra lenta segue o modelo cinematico')
slowManoeuvreIsKinematic()
console.log('esterco em manobra lenta custa o esperado')
slowManoeuvreDrag()
console.log('carro rolando livre para de verdade')
freeRollingStops()
console.log('manobra a 3 km/h e estavel')
slowManoeuvreIsSteady()

if (failures > 0) throw new Error(`${failures} verificacao(oes) de fisica falharam`)
console.log('tudo certo')
