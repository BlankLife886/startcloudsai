// 统一管理工具模式互斥关系：裁切、样机、比较、分解、AI 面板不能随意叠在一起。
export function usePreviewModeCoordinator({
  cropMode,
  currentFitMode,
  comparisonMode,
  mockupMode,
  showAiPanel,
  showDecomposePanel,
  settingsStore,
  applyPreferredFitMode,
  resetZoom,
  applyConstraints,
  cancelCropMode,
  enterCropMode,
  clearMockupMode,
  toggleDesktopMockup: toggleDesktopMockupBase,
  togglePhoneMockup: togglePhoneMockupBase,
  setComparisonMode,
  toggleComparisonMode,
  decomposeImage: decomposeImageBase,
  selectConfiguredAiModel,
  logAiSourceSizeCandidates,
}) {
  function closeCropIfActive() {
    if (cropMode.value) cancelCropMode()
  }

  function closeMockup() {
    clearMockupMode()
  }

  function closeDecompose() {
    showDecomposePanel.value = false
  }

  function closeAiPanel() {
    showAiPanel.value = false
  }

  function prepareMockupMode() {
    closeCropIfActive()
    setComparisonMode('none')
    closeAiPanel()
    closeDecompose()
  }

  function toggleDesktopMockup() {
    prepareMockupMode()
    toggleDesktopMockupBase()
  }

  function togglePhoneMockup() {
    prepareMockupMode()
    togglePhoneMockupBase()
  }

  function toggleComparison() {
    closeCropIfActive()
    closeMockup()
    closeDecompose()
    // 对比需要完整看见图，先复位缩放，避免放大平移后半屏裁切。
    resetZoom()
    toggleComparisonMode('side-by-side')
  }

  function toggleCrop() {
    const canEnterCrop =
      !cropMode.value &&
      comparisonMode.value === 'none' &&
      mockupMode.value === 'none' &&
      !showAiPanel.value &&
      !showDecomposePanel.value

    if (!canEnterCrop) {
      cancelCropMode()
      return
    }

    // 裁切需要稳定的完整图像边界，进入前强制恢复 contain 和原始缩放。
    if (currentFitMode.value !== 'contain') {
      settingsStore.setSetting('fullscreen_preview_fit_mode', 'contain')
      applyPreferredFitMode()
    }
    resetZoom()
    applyConstraints()
    enterCropMode()
  }

  async function decomposeImage({ silent = false } = {}) {
    closeCropIfActive()
    closeMockup()
    setComparisonMode('none')
    closeAiPanel()
    await decomposeImageBase({ silent })
  }

  function toggleAiPanel() {
    showAiPanel.value = !showAiPanel.value
    if (!showAiPanel.value) return

    closeCropIfActive()
    closeMockup()
    closeDecompose()
    if (comparisonMode.value === 'none') {
      resetZoom()
      setComparisonMode('side-by-side')
    }
    selectConfiguredAiModel()
    logAiSourceSizeCandidates?.()
  }

  function prepareApplyAiHistory() {
    closeCropIfActive()
    closeMockup()
    closeDecompose()
  }

  function resetModesForOriginalImage({ preserveMockup = false } = {}) {
    if (!preserveMockup) closeMockup()
    cancelCropMode()
  }

  return {
    decomposeImage,
    prepareApplyAiHistory,
    resetModesForOriginalImage,
    toggleAiPanel,
    toggleComparison,
    toggleCrop,
    toggleDesktopMockup,
    togglePhoneMockup,
  }
}
