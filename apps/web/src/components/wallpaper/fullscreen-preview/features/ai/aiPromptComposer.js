export function createPreviewAiPromptComposer({
  aiState,
  settingsStore,
  imageProcessingConfig,
  getTargetAspectLabel,
  getOutputSize,
}) {
  const { aiCustomPrompt } = aiState

  function composeEnhancePrompt() {
    const variables = buildPromptVariables()
    const template = readImageProcessingString('promptTemplate')
    if (template) return renderPromptTemplate(template, variables)
    return variables.userPrompt
  }

  function appendQualityModePrompt(prompt) {
    const instruction = buildPromptVariables().qualityInstruction
    const template = readImageProcessingString('qualityPromptTemplate')
    if (!template || !instruction) return prompt
    const qualityPrompt = renderPromptTemplate(template, buildPromptVariables())
    return [prompt, qualityPrompt].map((item) => String(item || '').trim()).filter(Boolean).join('\n\n')
  }

  function buildPromptVariables() {
    const userPrompt = aiCustomPrompt.value.trim()
    const qualityInstruction = readQualityInstruction()
    return {
      userPrompt,
      goal: userPrompt || readImageProcessingString('defaultPromptGoal'),
      targetAspect: getTargetAspectLabel(),
      targetAspectLabel: getTargetAspectLabel(),
      outputSize: typeof getOutputSize === 'function' ? String(getOutputSize() || '').trim() : '',
      qualityInstruction,
      panelTitle: readImageProcessingString('panelTitle'),
    }
  }

  function readQualityInstruction() {
    const config = readImageProcessingConfig()
    const mode = String(
      settingsStore?.getSetting?.('ai_quality_mode', 'balanced') ||
        config.qualityMode ||
        'balanced',
    ).trim()
    const instructions = isPlainObject(config.qualityModeInstructions)
      ? config.qualityModeInstructions
      : {}
    return String(instructions[mode] || instructions.balanced || '').trim()
  }

  function readImageProcessingString(key) {
    return String(readImageProcessingConfig()[key] || '').trim()
  }

  function readImageProcessingConfig() {
    return imageProcessingConfig?.value && isPlainObject(imageProcessingConfig.value)
      ? imageProcessingConfig.value
      : isPlainObject(imageProcessingConfig)
        ? imageProcessingConfig
        : {}
  }

  return {
    appendQualityModePrompt,
    composeEnhancePrompt,
  }
}

function renderPromptTemplate(template, variables) {
  return String(template || '')
    .replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
      if (!Object.prototype.hasOwnProperty.call(variables, key)) return `{${key}}`
      return String(variables[key] || '')
    })
    .trim()
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}
