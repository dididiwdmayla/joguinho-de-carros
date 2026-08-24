/**
 * Where the artwork actually is inside a PNG.
 *
 * Two rectangles come out of every sprite, and the difference between them is
 * the whole point of this file.
 *
 * The first is the **trim**: every pixel that is not transparent padding. That
 * is what gets blitted, so nothing an artist drew is ever clipped off.
 *
 * The second is the **body**: the bodywork. A car sprite drawn from directly
 * above has its wing mirrors sticking out past the sides, and a mirror is not
 * what a manifest means by "1.8 m wide" -- a sedan is 1.8 m across the
 * panels, mirrors folded out or not. Taking the trim for the body is what put
 * a hand's width of empty air between the car and everything it stopped
 * against: the metres were being handed to a rectangle that was 16% taller
 * than the car, and the collision box built from those metres inherited every
 * centimetre of it.
 *
 * The body is found by asking, of each row and each column, how much of the
 * sprite it actually covers. A row that crosses the roof covers the whole
 * length of the car; a row that only clips the mirrors covers a tenth of it.
 * Everything under the threshold is an appendage and is left out of the body,
 * which is what the metres are then mapped to.
 *
 * No canvas, no DOM, nothing but an alpha buffer: measured in the browser at
 * load time, and measured exactly the same way by the tests.
 */

/** A rectangle inside an image, in image pixels. */
export interface PixelBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface SpriteBounds {
  /** Everything that is not padding: the rectangle that gets blitted. */
  readonly trim: PixelBox
  /** The bodywork, mirrors and other thin protrusions left out. */
  readonly body: PixelBox
}

/**
 * Alpha at or below this is padding. Low, because it only has to separate art
 * from empty space -- the soft edge of a sprite still belongs to the sprite.
 */
export const PADDING_ALPHA = 8

/**
 * And at or below this a pixel is a halo rather than the object: an
 * antialiased rim, a contact shadow bled a few pixels past the panel. Solid
 * enough to be sure, low enough that a glass roof still counts as car.
 */
export const SOLID_ALPHA = 200

/**
 * How much of the sprite a row or a column must cover to count as bodywork.
 *
 * A tenth. Wing mirrors, the widest appendage any of this art has, cover
 * around a twentieth of a car's length; the panels cover nearly all of it.
 * Anywhere between a twentieth and a third gives the same answer on every
 * sprite in the game, which is what a threshold picked out of a gap rather
 * than off a cliff looks like.
 *
 * A round object pays a little for this -- the very top of a circle covers
 * almost nothing -- but at a tenth that is under one per cent of a manhole's
 * diameter, and a manhole has never had to fit between two vans.
 */
const BODY_COVERAGE = 0.1

/** Reads one pixel's alpha out of a tightly packed RGBA buffer. */
type AlphaAt = (index: number) => number

/**
 * Measures an RGBA buffer, `width * height * 4` bytes, row-major.
 *
 * A fully transparent image has no bounds to report, so both rectangles come
 * back as the whole frame: better a sprite drawn inside its own padding than
 * one that cannot be drawn at all.
 */
export function measureSpriteBounds(
  data: ArrayLike<number>,
  width: number,
  height: number,
): SpriteBounds {
  const whole: PixelBox = { x: 0, y: 0, width, height }
  if (width <= 0 || height <= 0) return { trim: whole, body: whole }

  const alpha: AlphaAt = (index) => data[index * 4 + 3] ?? 0

  const trim = paddingBox(alpha, width, height)
  if (trim === null) return { trim: whole, body: whole }

  const body = bodyBox(alpha, width, trim)
  return { trim, body }
}

/** The smallest rectangle holding every pixel that is not padding. */
function paddingBox(alpha: AlphaAt, width: number, height: number): PixelBox | null {
  let top = 0
  while (top < height && !rowHasInk(alpha, width, top, 0, width - 1, PADDING_ALPHA)) top++
  if (top === height) return null

  let bottom = height - 1
  while (bottom > top && !rowHasInk(alpha, width, bottom, 0, width - 1, PADDING_ALPHA)) bottom--

  let left = 0
  while (left < width && !columnHasInk(alpha, width, left, top, bottom, PADDING_ALPHA)) left++

  let right = width - 1
  while (right > left && !columnHasInk(alpha, width, right, top, bottom, PADDING_ALPHA)) right--

  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/**
 * The bodywork inside `trim`: the rows and columns that carry a real share of
 * the solid pixels, with the thin stuff at the edges dropped.
 *
 * Each axis is measured against the fullest row (or column) of the sprite
 * rather than against its length, so a sprite that is mostly empty -- a
 * barrier, a diagonal crack -- is still measured against itself.
 */
function bodyBox(alpha: AlphaAt, imageWidth: number, trim: PixelBox): PixelBox {
  const left = trim.x
  const right = trim.x + trim.width - 1
  const top = trim.y
  const bottom = trim.y + trim.height - 1

  const rowCover = new Int32Array(trim.height)
  const columnCover = new Int32Array(trim.width)
  for (let y = top; y <= bottom; y++) {
    const base = y * imageWidth
    for (let x = left; x <= right; x++) {
      if (alpha(base + x) <= SOLID_ALPHA) continue
      rowCover[y - top]++
      columnCover[x - left]++
    }
  }

  const rows = coveredSpan(rowCover)
  const columns = coveredSpan(columnCover)
  // Nothing solid anywhere: art drawn entirely in soft edges. The trim is the
  // only honest answer left.
  if (rows === null || columns === null) return trim

  return {
    x: left + columns.from,
    y: top + rows.from,
    width: columns.to - columns.from + 1,
    height: rows.to - rows.from + 1,
  }
}

/** First and last entry reaching the coverage threshold, or null if none do. */
function coveredSpan(cover: Int32Array): { from: number; to: number } | null {
  let peak = 0
  for (const value of cover) if (value > peak) peak = value
  if (peak === 0) return null

  const threshold = peak * BODY_COVERAGE
  let from = 0
  while (from < cover.length && cover[from] < threshold) from++
  let to = cover.length - 1
  while (to > from && cover[to] < threshold) to--
  return { from, to }
}

function rowHasInk(
  alpha: AlphaAt,
  imageWidth: number,
  y: number,
  from: number,
  to: number,
  floor: number,
): boolean {
  const base = y * imageWidth
  for (let x = from; x <= to; x++) if (alpha(base + x) > floor) return true
  return false
}

function columnHasInk(
  alpha: AlphaAt,
  imageWidth: number,
  x: number,
  from: number,
  to: number,
  floor: number,
): boolean {
  for (let y = from; y <= to; y++) if (alpha(y * imageWidth + x) > floor) return true
  return false
}
