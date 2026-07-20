import { ref, unref } from 'vue'

// 下载弹窗需要知道“当前处理后图片”和自定义文件名，这里集中处理弹窗桥接数据。
export function usePreviewDownload({
  currentProcessedData,
  isInlineImageData,
  openDownloadModal,
  closeDownloadModal,
}) {
  const downloadProcessedData = ref('')
  const downloadCustomFilename = ref('')

  async function handleOpenDownloadModal({ processedData = '', customFilename = '' } = {}) {
    downloadCustomFilename.value = customFilename || ''

    const currentData = unref(currentProcessedData)
    const downloadData = processedData || (isInlineImageData(currentData) ? currentData : '')
    const result = await openDownloadModal({ processedImageData: downloadData })
    downloadProcessedData.value = result?.processedImageData || downloadData || ''
  }

  function handleCloseDownloadModal() {
    downloadProcessedData.value = ''
    downloadCustomFilename.value = ''
    closeDownloadModal()
  }

  return {
    downloadProcessedData,
    downloadCustomFilename,
    handleOpenDownloadModal,
    handleCloseDownloadModal,
  }
}
