const PROMPT_TASK_ROUTES = {
  t2i: '/text-to-image',
  infinite_canvas: '/canvas?mode=new',
  coloring: '/ai-illustration-coloring',
  ui_design: '/design-workshop',
  ecommerce_design: '/ecommerce-design',
  model_sheet: '/model-sheet',
  game_art: '/game-art',
  assistant: '/assistant',
}

export function studioRouteForTaskType(taskType = '') {
  return PROMPT_TASK_ROUTES[String(taskType)] || '/text-to-image'
}

function taskRecord(task) {
  return task && typeof task === 'object' ? task : {}
}

function taskParams(task) {
  const params = taskRecord(task).params
  return params && typeof params === 'object' && !Array.isArray(params) ? params : {}
}

export function isSmartCanvasTask(task) {
  const item = taskRecord(task)
  const params = taskParams(item)
  const source = String(item.source || params._source || params.source || '').trim().toLowerCase()
  const kind = String(params._kind || params.kind || '').trim().toLowerCase()
  const workspace = String(params.workspace || item.workspace || '').trim().toLowerCase()
  return source === 'react_canvas' || source === 'infinite_canvas' || workspace === 'infinite_canvas' || kind.startsWith('canvas-')
}

export function studioRouteForTask(task) {
  if (isSmartCanvasTask(task)) return '/canvas'
  return studioRouteForTaskType(taskRecord(task).type)
}
