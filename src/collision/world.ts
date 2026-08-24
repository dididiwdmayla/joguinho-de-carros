/**
 * The static side of a level, as the collision code sees it.
 *
 * Everything in here is immovable by definition: a parked car, a cone, a
 * planter and the invisible wall around the lot are all the same thing, a box
 * that does not move, does not fall over and cannot be pushed. That is a
 * deliberate simplification and the whole reason the response in
 * `vehicleCollision.ts` is as short as it is -- there is only ever one moving
 * body in the equations.
 */
import { obbExtentX, obbExtentY, type Obb } from './obb'
import { buildGrid, type GridBounds, type SpatialGrid } from './grid'

/** What a body is, for the damage log and for the debug overlay. */
export type BodyKind = 'carro' | 'obstaculo' | 'muro'

export interface StaticBody {
  readonly box: Obb
  readonly kind: BodyKind
  /** Manifest key or level id of whatever this box stands for, for debugging. */
  readonly label: string
}

export interface CollisionWorld {
  readonly bodies: readonly StaticBody[]
  readonly grid: SpatialGrid
  /** Scratch list of candidate indices, refilled by every query. */
  readonly candidates: number[]
}

/**
 * Cell side of the broad phase [m]. A little over a car length: big enough
 * that a car spans at most four cells, small enough that a cell in a packed
 * row of bays holds two or three bodies.
 */
const CELL_SIZE = 6

export function createWorld(bodies: readonly StaticBody[]): CollisionWorld {
  const bounds: GridBounds[] = bodies.map((body) => boundsOf(body.box))
  return {
    bodies,
    grid: buildGrid(bounds, CELL_SIZE),
    candidates: [],
  }
}

export function boundsOf(box: Obb): GridBounds {
  const extentX = obbExtentX(box)
  const extentY = obbExtentY(box)
  return {
    minX: box.x - extentX,
    minY: box.y - extentY,
    maxX: box.x + extentX,
    maxY: box.y + extentY,
  }
}
