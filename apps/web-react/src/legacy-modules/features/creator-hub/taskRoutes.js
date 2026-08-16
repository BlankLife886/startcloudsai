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

export function isSmartCanvasTask(task = {}) {
  const params = task?.params && typeof task.params === 'object' ? task.params : {}
  const source = String(params._source || params.source || '').trim().toLowerCase()
  const kind = String(params._kind || params.kind || '').trim().toLowerCase()
  return source === 'react_canvas' || kind.startsWith('canvas-')
}

export function studioRouteForTask(task = {}) {
  if (isSmartCanvasTask(task)) return '/canvas'
  return studioRouteForTaskType(task?.type)
}
