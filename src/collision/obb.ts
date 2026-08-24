/**
 * Oriented boxes and the separating axis test between two of them.
 *
 * Every solid thing in a level is one of these: the car, a parked car, a cone,
 * a wall. A box carries its own angle, so a car parked across the corner of
 * the lot is a box at that angle and not an axis-aligned rectangle pretending.
 *
 * Sizes always arrive in metres from the asset manifest. The pixel dimensions
 * of a PNG never reach this file, and never should: the art is drawn at the
 * size the manifest declares, so the only box that can agree with what the
 * player sees is one built from the same numbers.
 */

export interface Obb {
  /** Centre in world metres. */
  x: number
  y: number
  /** Half extent along the box's own +X axis [m]. */
  halfLength: number
  /** Half extent along the box's own +Y axis [m]. */
  halfWidth: number
  /** Rotation of the box's axes [rad]. */
  angle: number
  /** cos/sin of `angle`, kept beside it so a test never recomputes them. */
  cos: number
  sin: number
}

/** One overlap: how deep, along which direction, and where. */
export interface Contact {
  /** Penetration depth along the normal [m]. */
  depth: number
  /** Unit normal, pointing from the static box towards the moving one. */
  nx: number
  ny: number
  /** Point of contact, world metres. */
  px: number
  py: number
}

export function createObb(
  x: number,
  y: number,
  length: number,
  width: number,
  angle: number,
): Obb {
  return {
    x,
    y,
    halfLength: length / 2,
    halfWidth: width / 2,
    angle,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
  }
}

export function createContact(): Contact {
  return { depth: 0, nx: 0, ny: 0, px: 0, py: 0 }
}

/** Moves a box, refreshing the cached rotation. */
export function setObbPose(box: Obb, x: number, y: number, angle: number): void {
  box.x = x
  box.y = y
  if (angle !== box.angle) {
    box.angle = angle
    box.cos = Math.cos(angle)
    box.sin = Math.sin(angle)
  }
}

/** Radius of the circle that contains the box, for cheap range queries. */
export function obbRadius(box: Obb): number {
  return Math.hypot(box.halfLength, box.halfWidth)
}

/** Half width of the box's shadow on the world X axis [m]. */
export function obbExtentX(box: Obb): number {
  return Math.abs(box.cos) * box.halfLength + Math.abs(box.sin) * box.halfWidth
}

/** Half width of the box's shadow on the world Y axis [m]. */
export function obbExtentY(box: Obb): number {
  return Math.abs(box.sin) * box.halfLength + Math.abs(box.cos) * box.halfWidth
}

/** Whether a world point lies inside the box. */
export function obbContains(box: Obb, x: number, y: number): boolean {
  const dx = x - box.x
  const dy = y - box.y
  const localX = dx * box.cos + dy * box.sin
  const localY = -dx * box.sin + dy * box.cos
  return Math.abs(localX) <= box.halfLength && Math.abs(localY) <= box.halfWidth
}

/**
 * Writes the four corners into `out` as x,y pairs, in the order
 * (+L,+W) (+L,-W) (-L,-W) (-L,+W).
 */
export function obbCorners(box: Obb, out: number[]): void {
  const ax = box.cos * box.halfLength
  const ay = box.sin * box.halfLength
  const bx = -box.sin * box.halfWidth
  const by = box.cos * box.halfWidth
  out[0] = box.x + ax + bx
  out[1] = box.y + ay + by
  out[2] = box.x + ax - bx
  out[3] = box.y + ay - by
  out[4] = box.x - ax - bx
  out[5] = box.y - ay - by
  out[6] = box.x - ax + bx
  out[7] = box.y - ay + by
}

/** Half width of the box's shadow on an arbitrary unit axis. */
function projectionRadius(box: Obb, nx: number, ny: number): number {
  return (
    Math.abs(box.cos * nx + box.sin * ny) * box.halfLength +
    Math.abs(-box.sin * nx + box.cos * ny) * box.halfWidth
  )
}

/** Scratch for the contact patch, so a test in the frame loop allocates nothing. */
const faceStart = { x: 0, y: 0 }
const faceEnd = { x: 0, y: 0 }
const cornerScratch = { x: 0, y: 0 }

/**
 * Separating axis test between two oriented boxes.
 *
 * Four axes are enough in two dimensions: the two boxes contribute two face
 * normals each, and if the boxes overlap on all four they overlap. The axis
 * with the smallest overlap is the shortest way out, which is what the
 * response pushes along.
 *
 * Returns false when they are apart. When they touch, `out` is filled with the
 * depth, the normal pointing from `stat` towards `moving`, and the point the
 * two are pressing against each other at -- the deepest corner of whichever
 * box is not the one that owns the axis, which is where a corner meets a face.
 */
export function collideObb(moving: Obb, stat: Obb, out: Contact): boolean {
  const dx = moving.x - stat.x
  const dy = moving.y - stat.y

  best.depth = Infinity
  // Four candidate axes: two face normals from each box. Tested one at a time
  // rather than through a list of them -- this runs for every nearby obstacle
  // of every frame, and a list would be four objects of garbage per pair.
  //
  // The static box's axes go first, and an axis only wins by being strictly
  // shallower, so a tie belongs to the obstacle. That matters more than it
  // looks: two boxes square to each other overlap by the same amount on both
  // of their X axes, and the tie decides whether the contact is taken as a
  // corner of the car against a wall -- which it is -- or as a corner of the
  // wall against the car, which for a twenty metre wall is a corner ten
  // metres away and a moment arm to match.
  if (!testAxis(moving, stat, dx, dy, stat.cos, stat.sin, true)) return false
  if (!testAxis(moving, stat, dx, dy, -stat.sin, stat.cos, true)) return false
  if (!testAxis(moving, stat, dx, dy, moving.cos, moving.sin, false)) return false
  if (!testAxis(moving, stat, dx, dy, -moving.sin, moving.cos, false)) return false

  // The axis belongs to one box's face; the other box is the one that ran
  // into it. Where they are pressing is worked out from the pair.
  const reference = best.fromStatic ? stat : moving
  const incident = best.fromStatic ? moving : stat
  contactPoint(reference, incident, best.nx, best.ny, cornerScratch)

  out.depth = best.depth
  out.nx = best.nx
  out.ny = best.ny
  out.px = cornerScratch.x
  out.py = cornerScratch.y
  return true
}

/**
 * Where the two boxes are actually pressing against each other.
 *
 * Taking the single deepest corner is the obvious answer and the wrong one. A
 * car driven square into a wall meets it with its whole front, and a response
 * applied at one front corner would spin the car every time it stopped
 * against something flat -- which in a game about parking is most of the time.
 *
 * So the real patch is built: the face of the incident box that is turned
 * towards the reference one, cut down to the part that is over the reference
 * face and behind it. What comes back is the middle of that patch, which is a
 * corner when a corner is what touched and the centre of the bumper when the
 * whole bumper did.
 */
function contactPoint(
  reference: Obb,
  incident: Obb,
  nx: number,
  ny: number,
  out: { x: number; y: number },
): void {
  incidentFace(incident, nx, ny, faceStart, faceEnd)

  // Along the face, measured from the reference box's centre.
  const tx = -ny
  const ty = nx
  const reach = projectionRadius(reference, tx, ty)
  let from = (faceStart.x - reference.x) * tx + (faceStart.y - reference.y) * ty
  let to = (faceEnd.x - reference.x) * tx + (faceEnd.y - reference.y) * ty

  // Cut the segment down to the width of the reference face. A patch that
  // hangs off the end of a wall is not touching the wall out there.
  let startT = 0
  let endT = 1
  const span = to - from
  if (Math.abs(span) > 1e-9) {
    const lower = (-reach - from) / span
    const upper = (reach - from) / span
    startT = Math.max(0, Math.min(1, Math.min(lower, upper)))
    endT = Math.max(0, Math.min(1, Math.max(lower, upper)))
    if (endT < startT) {
      // No overlap along the face at all: the nearest end of it is the
      // contact, which is the corner-to-corner case.
      startT = endT
    }
  } else {
    from = Math.max(-reach, Math.min(reach, from))
    to = from
  }

  const p1x = faceStart.x + (faceEnd.x - faceStart.x) * startT
  const p1y = faceStart.y + (faceEnd.y - faceStart.y) * startT
  const p2x = faceStart.x + (faceEnd.x - faceStart.x) * endT
  const p2y = faceStart.y + (faceEnd.y - faceStart.y) * endT

  // Only the parts that are actually behind the reference face count. The
  // plane of that face sits `reach` along the normal from its centre.
  const facePlane = reference.x * nx + reference.y * ny + projectionRadius(reference, nx, ny)
  const depth1 = facePlane - (p1x * nx + p1y * ny)
  const depth2 = facePlane - (p2x * nx + p2y * ny)
  const keep1 = depth1 > 0
  const keep2 = depth2 > 0

  if (keep1 && keep2) {
    out.x = (p1x + p2x) / 2
    out.y = (p1y + p2y) / 2
  } else if (keep1) {
    out.x = p1x
    out.y = p1y
  } else if (keep2) {
    out.x = p2x
    out.y = p2y
  } else {
    // Neither endpoint is behind the plane, which only happens at the very
    // edge of numerical agreement with the axis test. The deeper one is the
    // honest answer.
    const first = depth1 >= depth2
    out.x = first ? p1x : p2x
    out.y = first ? p1y : p2y
  }
}

/**
 * The face of `box` turned towards -n: the edge whose outward normal is most
 * opposed to the contact normal. Written into `start` and `end`.
 */
function incidentFace(
  box: Obb,
  nx: number,
  ny: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
): void {
  // How much each of the box's own axes faces away from the normal.
  const alongX = -(box.cos * nx + box.sin * ny)
  const alongY = -(-box.sin * nx + box.cos * ny)

  let faceX: number
  let faceY: number
  let edgeX: number
  let edgeY: number
  let half: number
  if (Math.abs(alongX) >= Math.abs(alongY)) {
    const sign = alongX >= 0 ? 1 : -1
    faceX = box.cos * sign * box.halfLength
    faceY = box.sin * sign * box.halfLength
    edgeX = -box.sin
    edgeY = box.cos
    half = box.halfWidth
  } else {
    const sign = alongY >= 0 ? 1 : -1
    faceX = -box.sin * sign * box.halfWidth
    faceY = box.cos * sign * box.halfWidth
    edgeX = box.cos
    edgeY = box.sin
    half = box.halfLength
  }

  const centerX = box.x + faceX
  const centerY = box.y + faceY
  start.x = centerX - edgeX * half
  start.y = centerY - edgeY * half
  end.x = centerX + edgeX * half
  end.y = centerY + edgeY * half
}

/** Shallowest axis found so far by the test below. */
const best = { depth: 0, nx: 0, ny: 0, fromStatic: true }

/**
 * One axis of the four. Returns false the moment a gap is found, which ends
 * the whole test: one axis with daylight on it is a proof of separation.
 */
function testAxis(
  moving: Obb,
  stat: Obb,
  dx: number,
  dy: number,
  nx: number,
  ny: number,
  own: boolean,
): boolean {
  const separation = dx * nx + dy * ny
  const overlap =
    projectionRadius(moving, nx, ny) + projectionRadius(stat, nx, ny) - Math.abs(separation)
  if (overlap <= 0) return false
  if (overlap < best.depth) {
    best.depth = overlap
    // Always pointing from the static box towards the moving one, whichever
    // way round the axis was written.
    const sign = separation >= 0 ? 1 : -1
    best.nx = nx * sign
    best.ny = ny * sign
    best.fromStatic = own
  }
  return true
}
