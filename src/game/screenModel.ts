/**
 * What each panel says.
 *
 * The models are built from the flow and from nothing else, once per change
 * rather than once per frame: a panel is a photograph of a moment -- the run
 * that just ended, the levels as they stand -- and nothing on it moves.
 *
 * Keeping this apart from both the flow and the layout is what stops the three
 * from tangling: the flow knows the game, this file knows the words, and
 * screens.ts knows where they go.
 */
import { formatTime, type ScreenModel, type ScreenStat } from '../ui/screens'
import type { LevelDefinition } from '../level/levelSchema'
import { radToDeg } from '../core/math'
import type { FlowState } from './flow'

/** The panel for the phase the game is in, or null while it is being played. */
export function screenModelFor(
  flow: FlowState,
  levels: readonly LevelDefinition[],
): ScreenModel | null {
  switch (flow.phase) {
    case 'jogando':
      return null
    case 'menu':
      return levelListModel(flow, levels)
    case 'carregando':
      return {
        kind: 'carregando',
        title: 'CARREGANDO',
        subtitle: levels[flow.levelIndex]?.name ?? '',
        stars: null,
        stats: [],
        levels: [],
        buttons: [],
      }
    case 'pausado':
      return pauseModel(flow, levels)
    case 'concluido':
      return completedModel(flow, levels)
    case 'falhou':
      return failedModel(flow, levels)
  }
}

function levelListModel(flow: FlowState, levels: readonly LevelDefinition[]): ScreenModel {
  return {
    kind: 'fases',
    title: 'FASES',
    subtitle: 'escolha onde estacionar',
    stars: null,
    stats: [],
    levels: levels.map((level, index) => {
      const record = flow.progress[level.id]
      return {
        index,
        name: level.name,
        difficulty: level.difficulty,
        stars: record?.stars ?? 0,
        time: record?.time ?? null,
      }
    }),
    buttons: [{ action: { kind: 'ajustes' }, label: 'AJUSTES', enabled: true }],
  }
}

function pauseModel(flow: FlowState, levels: readonly LevelDefinition[]): ScreenModel {
  const level = levels[flow.levelIndex]
  return {
    kind: 'pausa',
    title: 'PAUSA',
    subtitle: level?.name ?? '',
    stars: null,
    stats: [
      { label: 'TEMPO', value: formatTime(flow.run.time) },
      { label: 'DANO', value: flow.run.damage.total.toFixed(1) },
    ],
    levels: [],
    buttons: [
      { action: { kind: 'continuar' }, label: 'CONTINUAR', enabled: true, primary: true },
      { action: { kind: 'repetir' }, label: 'REINICIAR', enabled: true },
      { action: { kind: 'ajustes' }, label: 'AJUSTES', enabled: true },
      { action: { kind: 'fases' }, label: 'FASES', enabled: true },
    ],
  }
}

function completedModel(flow: FlowState, levels: readonly LevelDefinition[]): ScreenModel {
  const level = levels[flow.levelIndex]
  const result = flow.result
  const stats: ScreenStat[] = []
  if (result !== null && level !== undefined) {
    stats.push({
      label: 'TEMPO',
      value: `${formatTime(result.summary.time)}  (alvo ${formatTime(level.params.targetTime)})`,
    })
    stats.push({ label: 'DANO', value: result.summary.damage.toFixed(1) })
    stats.push({ label: 'MOTOR MORTO', value: String(result.summary.stalls) })
    stats.push({
      label: 'PRECISAO',
      value: `${(result.summary.distance * 100).toFixed(0)} cm  ${radToDeg(result.summary.angleError).toFixed(0)} graus`,
    })
    stats.push({
      label: result.best ? 'PONTOS (RECORDE)' : 'PONTOS',
      value: result.score.points.toFixed(0),
      highlight: result.best,
    })
  }

  const last = flow.levelIndex >= levels.length - 1
  return {
    kind: 'concluido',
    title: 'ESTACIONADO',
    subtitle: level?.name ?? '',
    stars: result?.score.stars ?? 1,
    stats,
    levels: [],
    buttons: [
      { action: { kind: 'repetir' }, label: 'REPETIR', enabled: true },
      { action: { kind: 'avancar' }, label: 'AVANCAR', enabled: !last, primary: !last },
      { action: { kind: 'fases' }, label: 'FASES', enabled: true, primary: last },
    ],
  }
}

function failedModel(flow: FlowState, levels: readonly LevelDefinition[]): ScreenModel {
  const level = levels[flow.levelIndex]
  return {
    kind: 'falhou',
    title: 'FALHOU',
    subtitle: flow.failure === 'tempo' ? 'o tempo acabou' : 'dano demais no carro',
    stars: null,
    stats: [
      { label: 'TEMPO', value: formatTime(flow.run.time) },
      { label: 'DANO', value: flow.run.damage.total.toFixed(1), highlight: flow.failure === 'dano' },
      { label: 'FASE', value: level?.name ?? '' },
    ],
    levels: [],
    buttons: [
      { action: { kind: 'repetir' }, label: 'REPETIR', enabled: true, primary: true },
      { action: { kind: 'fases' }, label: 'FASES', enabled: true },
    ],
  }
}
