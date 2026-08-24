/**
 * The H gate, drawn as vector from the gear pattern.
 *
 * Every channel here exists because shifter.json says a gear seats there.
 * Nothing is measured off a picture and nothing is calibrated by hand: move a
 * gear to another column in the JSON and its channel moves with it, because
 * the same list feeds the engagement rule. A side with no position simply has
 * no channel, which is why the top of the reverse column comes out solid.
 *
 * It is an SVG element over the canvas rather than canvas drawing, because the
 * gate has to react -- lit while a gear is in, dimmed with the clutch out, a
 * single red flash when it refuses. Those are class and attribute changes on
 * elements that were built once, so a frame never rebuilds the drawing; the
 * browser tweens the colours itself.
 */
import type { LoadedUiImage } from '../assets/loader'
import { gearLabel, NEUTRAL_GEAR } from '../vehicle/powertrain'
import {
  columnCenterUnits,
  corridorYUnits,
  GATE_UNITS,
  labelOffsetUnits,
  plateHeightUnits,
  plateWidthUnits,
  type ShifterPattern,
  type ShifterPosition,
} from './shifterPattern'
import type { Rect } from './touchLayout'

/** Manifest keys of the two pieces of gearbox art. */
export const GEAR_GATE_KEY = 'gear_gate'
export const GEAR_KNOB_KEY = 'gear_knob'

/**
 * How the plate itself is drawn:
 *   'gradient' -- a vertical greyscale ramp standing in for brushed metal,
 *                 with no asset at all;
 *   'texture'  -- gear_gate.png stretched to cover the plate and cropped by
 *                 it, so the brushed grain is the real thing.
 * The channels, the numbers and every visual state are identical either way.
 *
 * Worth knowing before choosing: the PNG has its own H painted into it, and
 * nothing here can take it back out. In texture mode the art's channels come
 * along with its grain and sit behind the ones the pattern draws, at whatever
 * spacing the picture happens to use.
 */
export type GatePlateMode = 'gradient' | 'texture'

/** Flip this to compare the two. `?placa=textura` overrides it without a build. */
const DEFAULT_PLATE_MODE: GatePlateMode = 'gradient'

/**
 * The plate mode in force, read once. The query string is only a shortcut for
 * looking at the other one; the constant above is what ships.
 */
export function resolveGatePlateMode(): GatePlateMode {
  try {
    const asked = new URLSearchParams(window.location.search).get('placa')
    if (asked === 'textura' || asked === 'texture') return 'texture'
    if (asked === 'gradiente' || asked === 'gradient') return 'gradient'
  } catch {
    // A browser that will not parse its own URL still gets the default.
  }
  return DEFAULT_PLATE_MODE
}

// ------------------------------------------------------------------- carving
//
// The routed look comes from three bands taken off the one channel shape: a
// thin rim all the way round it, a darker band along its upper edge, and a
// pale one along its lower edge. Each band is a mask built by drawing the
// shape in white and the same shape displaced in black, so the leftover white
// is exactly the strip that is wanted. Offsets are in drawing units.

/** Width of the cut edge that runs all the way round a channel. */
const RIM = 1.8
/** How deep the shadow reaches down from a channel's upper edge. */
const TOP_SHADE = 4.5
/** How far the highlight reaches up from a channel's lower edge. */
const BOTTOM_LIGHT = 3
/** Dark line marking where the plate stops, and the bevel just inside it. */
const EDGE = 2.5
const BEVEL = 3

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Ids have to be unique in the page, and the page is shared with the canvas. */
let instanceCount = 0

const STYLE = `
.gate-svg {
  position: fixed;
  pointer-events: none;
  overflow: visible;
  -webkit-user-select: none;
  user-select: none;
}
.gate-channel {
  fill: none;
  stroke: rgba(0, 0, 0, 0);
  stroke-linecap: round;
  transition: stroke 200ms ease;
}
/* Clutch out: nothing can go in, so every gear channel is shut. The corridor
   is not one of them -- neutral always takes. */
.gate-svg.gate-locked .gate-channel {
  stroke: rgba(2, 4, 7, 0.72);
}
/* Where the lever may go next from where it is. Two-phase movement, without
   a line of text explaining it. */
.gate-channel.gate-reachable {
  stroke: rgba(206, 228, 255, 0.19);
}
/* The gear that is actually in. */
.gate-channel.gate-engaged {
  stroke: rgba(150, 200, 255, 0.26);
}
/* Asked for with the clutch out: one flash, and it does not come back until
   the lever is asked again. */
.gate-channel.gate-refused {
  animation: gate-refused 460ms ease-out 1;
}
@keyframes gate-refused {
  0% { stroke: rgba(228, 96, 88, 0); }
  18% { stroke: rgba(228, 96, 88, 0.5); }
  100% { stroke: rgba(228, 96, 88, 0); }
}
.gate-label {
  fill: rgba(226, 236, 245, 0.86);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-weight: 600;
  transition: fill 200ms ease;
}
.gate-svg.gate-locked .gate-label {
  fill: rgba(226, 236, 245, 0.38);
}
.gate-label.gate-engaged {
  fill: #9ecbff;
}
`

/** What the gate has to show. Read once per frame; only changes touch the DOM. */
export interface GateView {
  /** Continuous column the lever is over. */
  readonly column: number
  /** -1 fully up, 0 the corridor, +1 fully down. */
  readonly lane: number
  /** Gear the box is actually in. */
  readonly gear: number
  /** True while the clutch is out and nothing can be engaged. */
  readonly locked: boolean
  readonly dragging: boolean
  /** True while the gate is refusing the gear the lever is pushing into. */
  readonly blocked: boolean
  /** Forward gears the fitted box has, so a missing one draws no channel. */
  readonly forwardGears: number
  /** How solid the plate is drawn. Ghosted like any other control while the
   *  editor is arranging it; opaque otherwise. */
  readonly opacity: number
  /**
   * True while the editor's own canvas-drawn chrome -- a control's outline,
   * name chip and resize handle -- needs to sit on top of the gate rather
   * than under it. The gate is a DOM element above the canvas by default, the
   * one place a later canvas draw call cannot paint over an earlier one, so
   * this is the escape hatch: it drops behind the canvas for exactly as long
   * as something drawn on the canvas needs to be seen over it.
   */
  readonly behindCanvas: boolean
}

/** A loaded PNG, ready to be placed in the drawing by its opaque box. */
export interface GateArt {
  readonly src: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly naturalWidth: number
  readonly naturalHeight: number
}

/** The bounding box the loader measured, in the form the SVG wants it. */
export function gateArt(image: LoadedUiImage): GateArt {
  return {
    src: image.image.src,
    x: image.trim.x,
    y: image.trim.y,
    width: image.trim.width,
    height: image.trim.height,
    naturalWidth: image.image.naturalWidth,
    naturalHeight: image.image.naturalHeight,
  }
}

export interface GateOverlayOptions {
  readonly pattern: ShifterPattern
  /** Positions above this are not on this car, and get no channel. */
  readonly forwardGears: number
  readonly plateMode: GatePlateMode
  /** gear_gate.png, needed only in texture mode. */
  readonly plateImage: GateArt | null
  readonly knobImage: GateArt
}

interface Channel {
  readonly position: ShifterPosition
  readonly path: SVGPathElement
  readonly label: SVGTextElement
  reachable: boolean
  engaged: boolean
}

/**
 * The gate as a live element. Built once from the pattern; after that every
 * frame only writes the handful of attributes that actually moved.
 */
export class GateOverlay {
  private readonly root: SVGSVGElement
  private readonly knob: SVGGElement
  private readonly channels: readonly Channel[]

  /** Last values written to the DOM, so an unchanged frame writes nothing. */
  private placed: Rect = { x: NaN, y: NaN, width: NaN, height: NaN }
  private knobTransform = ''
  private locked = false
  private visible = false
  private opacity = 1
  private behindCanvas = false
  /** Refusal is an event, not a state: only the moment it turns on flashes. */
  private wasBlocked = false

  constructor(options: GateOverlayOptions) {
    const { pattern } = options
    const id = `gate${++instanceCount}`
    // Everything inside is in drawing units; the viewBox is what turns them
    // into whatever size the layout hands over, at any pixel density.
    const width = plateWidthUnits(pattern)
    const height = plateHeightUnits()

    this.root = document.createElementNS(SVG_NS, 'svg')
    this.root.setAttribute('class', 'gate-svg')
    this.root.setAttribute('viewBox', `0 0 ${round(width)} ${round(height)}`)
    this.root.setAttribute('aria-hidden', 'true')
    this.root.style.display = 'none'

    const style = document.createElementNS(SVG_NS, 'style')
    style.textContent = STYLE
    this.root.append(style)

    const network = channelNetworkPath(pattern, options.forwardGears)
    this.root.append(buildDefs(id, network, width, height, options))
    this.root.append(buildPlate(id, width, height, options))
    this.root.append(buildCarving(id, width, height))

    const states = document.createElementNS(SVG_NS, 'g')
    const labels = document.createElementNS(SVG_NS, 'g')
    const channels: Channel[] = []
    for (const position of livePositions(pattern, options.forwardGears)) {
      const path = channelStatePath(position)
      const label = channelLabel(position)
      states.append(path)
      labels.append(label)
      channels.push({ position, path, label, reachable: false, engaged: false })
    }
    this.channels = channels
    this.root.append(states, labels)

    this.knob = buildKnob(id, options.knobImage)
    this.root.append(this.knob)

    document.body.append(this.root)
  }

  /**
   * Puts the gate on `plate` and shows what the lever is doing. Called every
   * frame; every write below is behind a comparison, so a still gate is free.
   */
  sync(plate: Rect, view: GateView): void {
    if (!this.visible) {
      this.root.style.display = ''
      this.visible = true
    }
    this.place(plate)
    this.setLocked(view.locked)
    this.setOpacity(view.opacity)
    this.setBehindCanvas(view.behindCanvas)
    this.updateChannels(view)
    this.updateKnob(view)
    this.updateRefusal(view)
  }

  /** Takes the gate off the screen: another gearbox, or nothing to drive. */
  hide(): void {
    if (!this.visible) return
    this.root.style.display = 'none'
    this.visible = false
    this.wasBlocked = false
    // A hidden element's animations are cancelled and start again when it
    // comes back, so a refusal left on a channel would flash a second time at
    // a moment nobody asked for anything.
    for (const channel of this.channels) channel.path.classList.remove('gate-refused')
  }

  destroy(): void {
    this.root.remove()
  }

  private place(plate: Rect): void {
    const previous = this.placed
    if (
      plate.x === previous.x &&
      plate.y === previous.y &&
      plate.width === previous.width &&
      plate.height === previous.height
    ) {
      return
    }
    this.placed = { ...plate }
    const style = this.root.style
    style.left = `${plate.x}px`
    style.top = `${plate.y}px`
    style.width = `${plate.width}px`
    style.height = `${plate.height}px`
  }

  private setLocked(locked: boolean): void {
    if (locked === this.locked) return
    this.locked = locked
    this.root.classList.toggle('gate-locked', locked)
  }

  private setOpacity(opacity: number): void {
    if (opacity === this.opacity) return
    this.opacity = opacity
    this.root.style.opacity = String(opacity)
  }

  /**
   * Below the canvas rather than above it, for as long as the editor needs
   * its own outline, name chip and resize handle -- painted on the canvas
   * after everything else -- to read on top of the plate instead of under it.
   */
  private setBehindCanvas(behindCanvas: boolean): void {
    if (behindCanvas === this.behindCanvas) return
    this.behindCanvas = behindCanvas
    this.root.style.zIndex = behindCanvas ? '-1' : ''
  }

  private updateChannels(view: GateView): void {
    // Where the lever may go from here. Out of the corridor the column is
    // held and the lane it is in is the one it is already using, so nothing
    // lights up; in the corridor it is whichever channels the column under it
    // has. The clutch being out beats all of it.
    const column = Math.round(view.column)
    const offering = view.dragging && !view.locked && view.lane === 0 ? column : null

    for (const channel of this.channels) {
      const engaged = view.gear !== NEUTRAL_GEAR && channel.position.gear === view.gear
      if (engaged !== channel.engaged) {
        channel.engaged = engaged
        channel.path.classList.toggle('gate-engaged', engaged)
        channel.label.classList.toggle('gate-engaged', engaged)
      }
      const reachable = channel.position.column === offering && !engaged
      if (reachable !== channel.reachable) {
        channel.reachable = reachable
        channel.path.classList.toggle('gate-reachable', reachable)
      }
    }
  }

  private updateKnob(view: GateView): void {
    const x = columnCenterUnits(view.column)
    const y = corridorYUnits() + view.lane * GATE_UNITS.laneReach
    const transform = `translate(${round(x)} ${round(y)})`
    if (transform === this.knobTransform) return
    this.knobTransform = transform
    this.knob.setAttribute('transform', transform)
  }

  /** One flash per refusal: the moment the gate says no, and not again. */
  private updateRefusal(view: GateView): void {
    const blocked = view.blocked
    if (blocked && !this.wasBlocked) {
      const side = view.lane < 0 ? -1 : 1
      const column = Math.round(view.column)
      for (const channel of this.channels) {
        if (channel.position.column !== column || channel.position.side !== side) continue
        flash(channel.path)
        break
      }
    }
    this.wasBlocked = blocked
  }
}

/** Restarts the animation even when it is already running. */
function flash(element: SVGPathElement): void {
  element.classList.remove('gate-refused')
  // Reading the box is what commits the removal, so re-adding the class is a
  // second run rather than a continuation of the first.
  void element.getBoundingClientRect()
  element.classList.add('gate-refused')
}

// -------------------------------------------------------------- construction

/** Positions this car actually has: the rest are not routed into the plate. */
function livePositions(
  pattern: ShifterPattern,
  forwardGears: number,
): readonly ShifterPosition[] {
  return pattern.positions.filter(
    (position) => position.gear < 0 || position.gear <= forwardGears,
  )
}

/**
 * The routed network, as the two paths it takes to stroke it: the corridor
 * running the full width of the plate, and every channel dropping off it. Both
 * are stroked at the same width and both start on the corridor's centre line,
 * so what comes out is one continuous shape and not parts butted together.
 *
 * They are separate only because of their ends: a channel finishes in the
 * plate and gets a round tip, while the corridor runs off both edges and has
 * to be cut square there instead of bulging past them.
 */
interface ChannelNetwork {
  readonly corridor: string
  readonly channels: string
}

function channelNetworkPath(pattern: ShifterPattern, forwardGears: number): ChannelNetwork {
  const corridorY = round(corridorYUnits())
  const channels: string[] = []
  for (const position of livePositions(pattern, forwardGears)) {
    const x = round(columnCenterUnits(position.column))
    const tip = round(corridorYUnits() + position.side * GATE_UNITS.laneReach)
    channels.push(`M ${x} ${corridorY} V ${tip}`)
  }
  return {
    corridor: `M 0 ${corridorY} H ${round(plateWidthUnits(pattern))}`,
    channels: channels.join(' '),
  }
}

function strokedPath(
  d: string,
  color: string,
  width: number,
  dy: number,
  cap: 'round' | 'butt',
): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d)
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', color)
  path.setAttribute('stroke-width', round(Math.max(0, width)))
  path.setAttribute('stroke-linecap', cap)
  path.setAttribute('stroke-linejoin', 'round')
  if (dy !== 0) path.setAttribute('transform', `translate(0 ${round(dy)})`)
  return path
}

/**
 * A mask holding the strip of the channel network left over when the same
 * shape, displaced or narrowed, is taken out of it. `dy` slides the cut-out
 * copy, `inset` narrows it: together they carve out a rim, an upper edge or a
 * lower one.
 */
function bandMask(
  id: string,
  network: ChannelNetwork,
  width: number,
  height: number,
  dy: number,
  inset: number,
): SVGMaskElement {
  const mask = document.createElementNS(SVG_NS, 'mask')
  mask.setAttribute('id', id)
  mask.setAttribute('maskUnits', 'userSpaceOnUse')
  mask.setAttribute('x', '0')
  mask.setAttribute('y', '0')
  mask.setAttribute('width', round(width))
  mask.setAttribute('height', round(height))
  mask.append(strokedPath(network.corridor, '#fff', GATE_UNITS.channelWidth, 0, 'butt'))
  mask.append(strokedPath(network.channels, '#fff', GATE_UNITS.channelWidth, 0, 'round'))
  if (dy !== 0 || inset !== 0) {
    const cut = GATE_UNITS.channelWidth - inset * 2
    mask.append(strokedPath(network.corridor, '#000', cut, dy, 'butt'))
    mask.append(strokedPath(network.channels, '#000', cut, dy, 'round'))
  }
  return mask
}

function buildDefs(
  id: string,
  network: ChannelNetwork,
  width: number,
  height: number,
  options: GateOverlayOptions,
): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, 'defs')

  // The plate: a vertical ramp with a bright band high up, the way a brushed
  // face catches the light, and a darker foot.
  const plate = document.createElementNS(SVG_NS, 'linearGradient')
  plate.setAttribute('id', `${id}-plate`)
  plate.setAttribute('x1', '0')
  plate.setAttribute('y1', '0')
  plate.setAttribute('x2', '0')
  plate.setAttribute('y2', '1')
  for (const [offset, color] of [
    ['0', '#6c727a'],
    ['0.14', '#8d939c'],
    ['0.42', '#666c74'],
    ['0.7', '#535962'],
    ['1', '#41464d'],
  ] as const) {
    const stop = document.createElementNS(SVG_NS, 'stop')
    stop.setAttribute('offset', offset)
    stop.setAttribute('stop-color', color)
    plate.append(stop)
  }
  defs.append(plate)

  const bevel = document.createElementNS(SVG_NS, 'linearGradient')
  bevel.setAttribute('id', `${id}-bevel`)
  bevel.setAttribute('x1', '0')
  bevel.setAttribute('y1', '0')
  bevel.setAttribute('x2', '0')
  bevel.setAttribute('y2', '1')
  for (const [offset, color] of [
    ['0', 'rgba(255, 255, 255, 0.42)'],
    ['0.5', 'rgba(255, 255, 255, 0.06)'],
    ['1', 'rgba(0, 0, 0, 0.38)'],
  ] as const) {
    const stop = document.createElementNS(SVG_NS, 'stop')
    stop.setAttribute('offset', offset)
    stop.setAttribute('stop-color', color)
    bevel.append(stop)
  }
  defs.append(bevel)

  const clip = document.createElementNS(SVG_NS, 'clipPath')
  clip.setAttribute('id', `${id}-plate-clip`)
  clip.append(plateRect(width, height, 'none'))
  defs.append(clip)

  defs.append(bandMask(`${id}-channels`, network, width, height, 0, 0))
  defs.append(bandMask(`${id}-rim`, network, width, height, 0, RIM))
  defs.append(bandMask(`${id}-top`, network, width, height, TOP_SHADE, 0))
  defs.append(bandMask(`${id}-bottom`, network, width, height, -BOTTOM_LIGHT, 0))

  // A knob sitting on the plate rather than printed on it.
  const shadow = document.createElementNS(SVG_NS, 'radialGradient')
  shadow.setAttribute('id', `${id}-knob-shadow`)
  for (const [offset, color, opacity] of [
    ['0.55', '#000', '0.45'],
    ['1', '#000', '0'],
  ] as const) {
    const stop = document.createElementNS(SVG_NS, 'stop')
    stop.setAttribute('offset', offset)
    stop.setAttribute('stop-color', color)
    stop.setAttribute('stop-opacity', opacity)
    shadow.append(stop)
  }
  defs.append(shadow)

  if (options.plateMode === 'texture' && options.plateImage === null) {
    throw new Error('Modo de placa "textura" pedido sem a arte gear_gate.png carregada')
  }
  return defs
}

function plateRect(width: number, height: number, fill: string): SVGRectElement {
  const rect = document.createElementNS(SVG_NS, 'rect')
  rect.setAttribute('x', '0')
  rect.setAttribute('y', '0')
  rect.setAttribute('width', round(width))
  rect.setAttribute('height', round(height))
  rect.setAttribute('rx', round(GATE_UNITS.plateRadius))
  rect.setAttribute('fill', fill)
  return rect
}

function buildPlate(
  id: string,
  width: number,
  height: number,
  options: GateOverlayOptions,
): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('clip-path', `url(#${id}-plate-clip)`)

  if (options.plateMode === 'texture' && options.plateImage !== null) {
    // The art's own opaque box, blown up to cover the plate and cropped by it,
    // so the brushed grain survives whatever shape the pattern works out to --
    // and so does the H painted into the picture, underneath the routed one.
    group.append(croppedImage(options.plateImage, 0, 0, width, height, 'slice'))
  } else {
    group.append(plateRect(width, height, `url(#${id}-plate)`))
  }

  // A machined edge: a dark line where the plate stops, and a bevel just
  // inside it that catches the light at the top and loses it at the bottom.
  group.append(edgeRing(width, height, EDGE / 2, EDGE, 'rgba(0, 0, 0, 0.55)'))
  group.append(edgeRing(width, height, EDGE + BEVEL / 2, BEVEL, `url(#${id}-bevel)`))
  return group
}

/** A rounded outline inset into the plate, used for its edge and its bevel. */
function edgeRing(
  width: number,
  height: number,
  inset: number,
  thickness: number,
  stroke: string,
): SVGRectElement {
  const rect = document.createElementNS(SVG_NS, 'rect')
  rect.setAttribute('x', round(inset))
  rect.setAttribute('y', round(inset))
  rect.setAttribute('width', round(width - inset * 2))
  rect.setAttribute('height', round(height - inset * 2))
  rect.setAttribute('rx', round(Math.max(0, GATE_UNITS.plateRadius - inset)))
  rect.setAttribute('fill', 'none')
  rect.setAttribute('stroke', stroke)
  rect.setAttribute('stroke-width', round(thickness))
  return rect
}

/**
 * The channels themselves: the groove, the cut edge round it, the shadow along
 * its upper lip and the light along its lower one. Each is the same shape seen
 * through a different band mask, which is what makes them read as routed into
 * the plate rather than painted on it.
 */
function buildCarving(id: string, width: number, height: number): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g')
  for (const [mask, fill, opacity] of [
    [`${id}-channels`, '#1a1d22', '1'],
    [`${id}-rim`, '#05070a', '0.5'],
    [`${id}-top`, '#04060a', '0.85'],
    [`${id}-bottom`, '#ccd6df', '0.26'],
  ] as const) {
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', '0')
    rect.setAttribute('y', '0')
    rect.setAttribute('width', round(width))
    rect.setAttribute('height', round(height))
    rect.setAttribute('fill', fill)
    rect.setAttribute('opacity', opacity)
    rect.setAttribute('mask', `url(#${mask})`)
    group.append(rect)
  }
  return group
}

/**
 * The tinted overlay for one channel: exactly the channel's own shape, minus
 * the part of it that lies inside the corridor. Starting a channel-width out
 * and letting the round cap reach back puts its near end on the corridor's
 * edge, so dimming a gear never dims the corridor it hangs off.
 */
function channelStatePath(position: ShifterPosition): SVGPathElement {
  const x = round(columnCenterUnits(position.column))
  const from = corridorYUnits() + position.side * GATE_UNITS.channelWidth
  const to = corridorYUnits() + position.side * GATE_UNITS.laneReach
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('class', 'gate-channel')
  path.setAttribute('d', `M ${x} ${round(from)} V ${round(to)}`)
  path.setAttribute('stroke-width', round(GATE_UNITS.channelWidth))
  return path
}

/** The gear number, past the channel's tip on the side the channel points. */
function channelLabel(position: ShifterPosition): SVGTextElement {
  const text = document.createElementNS(SVG_NS, 'text')
  text.setAttribute('class', 'gate-label')
  text.setAttribute('x', round(columnCenterUnits(position.column)))
  text.setAttribute('y', round(corridorYUnits() + position.side * labelOffsetUnits()))
  text.setAttribute('font-size', round(GATE_UNITS.labelSize))
  text.setAttribute('text-anchor', 'middle')
  text.setAttribute('dominant-baseline', 'central')
  text.textContent = gearLabel(position.gear)
  return text
}

function buildKnob(id: string, knob: GateArt): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g')
  const diameter = GATE_UNITS.knobDiameter
  const half = diameter / 2

  const shadow = document.createElementNS(SVG_NS, 'ellipse')
  shadow.setAttribute('cx', '0')
  shadow.setAttribute('cy', round(diameter * 0.1))
  shadow.setAttribute('rx', round(half * 1.05))
  shadow.setAttribute('ry', round(half * 0.95))
  shadow.setAttribute('fill', `url(#${id}-knob-shadow)`)
  group.append(shadow)

  // The art is padded; the loader already measured its opaque box, so the
  // nested viewBox crops to exactly that and the knob fills the diameter.
  group.append(croppedImage(knob, -half, -half, diameter, diameter, 'meet'))
  return group
}

/**
 * A PNG shown through its own opaque box: the image is laid out at its full
 * pixel size and a nested viewBox cuts the padding away, so what lands in the
 * box is exactly the art and nothing around it. `slice` fills the box and
 * crops the overflow; `meet` fits the whole thing inside it.
 */
function croppedImage(
  art: GateArt,
  x: number,
  y: number,
  width: number,
  height: number,
  fit: 'slice' | 'meet',
): SVGSVGElement {
  const frame = document.createElementNS(SVG_NS, 'svg')
  frame.setAttribute('x', round(x))
  frame.setAttribute('y', round(y))
  frame.setAttribute('width', round(width))
  frame.setAttribute('height', round(height))
  frame.setAttribute('viewBox', `${art.x} ${art.y} ${art.width} ${art.height}`)
  frame.setAttribute('preserveAspectRatio', `xMidYMid ${fit}`)

  const image = document.createElementNS(SVG_NS, 'image')
  image.setAttribute('href', art.src)
  image.setAttribute('x', '0')
  image.setAttribute('y', '0')
  image.setAttribute('width', String(art.naturalWidth))
  image.setAttribute('height', String(art.naturalHeight))
  frame.append(image)
  return frame
}

/** Attribute values stay short: the numbers are units, not pixels. */
function round(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}
