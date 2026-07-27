import { ref } from 'vue'
import { uploadFile } from '@/services/tasksApi'
import notificationService from '@/services/notification'
import { uid } from '@/features/assistant/domain/assistantMessages'

export const MAX_ASSISTANT_REFERENCES = 4

/**
 * 助手多模态输入：参考图选择 / 粘贴 / 拖拽上传，统一走 uploadFile
 * （返回 fileKey，供 runs.referenceImages 与 Worker 读取存储使用）。
 */
export function useAssistantAttachments() {
  const referenceImages = ref([])
  const isUploadingReferences = ref(false)
  const uploadingReferenceCount = ref(0)
  const referenceInput = ref(null)
  const isDraggingAttachment = ref(false)
  let dragDepth = 0

  function openReferencePicker() {
    if (referenceImages.value.length >= MAX_ASSISTANT_REFERENCES) {
      notificationService.info(`最多添加 ${MAX_ASSISTANT_REFERENCES} 张参考图`)
      return
    }
    referenceInput.value?.click()
  }

  async function appendReferenceFiles(files, { pasted = false } = {}) {
    const imageFiles = [...files].filter((file) => file?.type?.startsWith('image/'))
    const available = Math.max(0, MAX_ASSISTANT_REFERENCES - referenceImages.value.length)
    if (!imageFiles.length) return 0
    if (!available) {
      notificationService.info(`最多添加 ${MAX_ASSISTANT_REFERENCES} 张图片`)
      return 0
    }
    try {
      isUploadingReferences.value = true
      uploadingReferenceCount.value = Math.min(imageFiles.length, available)
      const uploaded = await Promise.all(
        imageFiles.slice(0, available).map(async (file) => {
          const result = await uploadFile(file)
          return {
            id: uid(),
            name:
              file.name ||
              `剪贴板图片-${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
            dataUrl: result.url,
            thumbnailUrl: result.thumbnailUrl,
            fileKey: result.key,
          }
        }),
      )
      const existing = new Set(referenceImages.value.map((image) => image.fileKey || image.dataUrl))
      const uniqueImages = uploaded.filter(
        (image) => image.dataUrl && !existing.has(image.fileKey || image.dataUrl),
      )
      referenceImages.value.push(...uniqueImages)
      if (imageFiles.length > available) {
        notificationService.info(`图片最多保留 ${MAX_ASSISTANT_REFERENCES} 张`)
      } else if (uniqueImages.length < uploaded.length) {
        notificationService.info('已忽略重复图片')
      }
      if (pasted && uniqueImages.length) {
        notificationService.success(`已粘贴 ${uniqueImages.length} 张图片，可直接提问`)
      }
      return uniqueImages.length
    } catch (error) {
      notificationService.error(error?.message || (pasted ? '剪贴板图片上传失败' : '图片上传失败'))
      return 0
    } finally {
      isUploadingReferences.value = false
      uploadingReferenceCount.value = 0
    }
  }

  /** 兜底：把仅有临时 dataUrl 的图片重新上传，保证提交 runs 时都带 fileKey。 */
  async function ensureReferenceUploaded(image) {
    if (image?.fileKey) return image
    const source = String(image?.dataUrl || '').trim()
    if (!source) return null
    const response = await fetch(source, { credentials: 'include' })
    if (!response.ok) throw new Error('参考图读取失败，请重新添加')
    const blob = await response.blob()
    const extension =
      blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
    const file = new File([blob], image?.name || `assistant-reference.${extension}`, {
      type: blob.type || 'image/jpeg',
    })
    const uploaded = await uploadFile(file)
    return {
      ...image,
      dataUrl: uploaded.url,
      thumbnailUrl: uploaded.thumbnailUrl,
      fileKey: uploaded.key,
    }
  }

  async function handleReferenceFiles(event) {
    await appendReferenceFiles(event.target.files || [])
    event.target.value = ''
  }

  async function handleComposerPaste(event, { beforeAppend } = {}) {
    const clipboardItems = [...(event.clipboardData?.items || [])]
    const itemFiles = clipboardItems
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean)
    const files = itemFiles.length
      ? itemFiles
      : [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith('image/'))
    if (!files.length) return

    event.preventDefault()
    beforeAppend?.()
    await appendReferenceFiles(files, { pasted: true })
  }

  function removeReferenceImage(id) {
    referenceImages.value = referenceImages.value.filter((image) => image.id !== id)
  }

  function addAssetReference(asset) {
    if (referenceImages.value.length >= MAX_ASSISTANT_REFERENCES) {
      notificationService.info(`最多添加 ${MAX_ASSISTANT_REFERENCES} 张参考图`)
      return
    }
    if (referenceImages.value.some((image) => image.dataUrl === asset.dataUrl)) {
      notificationService.info('这张图片已在参考图中')
      return
    }
    referenceImages.value.push({ id: uid(), name: asset.label, dataUrl: asset.dataUrl })
    notificationService.success('已添加到参考图')
  }

  // 拖拽上传：depth 计数避免子元素 dragleave 抖动
  function hasDraggedFiles(event) {
    return [...(event.dataTransfer?.types || [])].includes('Files')
  }

  function handleAttachmentDragEnter(event) {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    dragDepth += 1
    isDraggingAttachment.value = true
  }

  function handleAttachmentDragOver(event) {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function handleAttachmentDragLeave(event) {
    if (!hasDraggedFiles(event)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (!dragDepth) isDraggingAttachment.value = false
  }

  async function handleAttachmentDrop(event) {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    dragDepth = 0
    isDraggingAttachment.value = false
    const files = [...(event.dataTransfer?.files || [])]
    if (!files.some((file) => file.type.startsWith('image/'))) {
      notificationService.info('仅支持拖入图片文件')
      return
    }
    await appendReferenceFiles(files)
  }

  function resetAttachments() {
    referenceImages.value = []
    dragDepth = 0
    isDraggingAttachment.value = false
  }

  return {
    referenceImages,
    isUploadingReferences,
    uploadingReferenceCount,
    referenceInput,
    isDraggingAttachment,
    openReferencePicker,
    appendReferenceFiles,
    ensureReferenceUploaded,
    handleReferenceFiles,
    handleComposerPaste,
    removeReferenceImage,
    addAssetReference,
    handleAttachmentDragEnter,
    handleAttachmentDragOver,
    handleAttachmentDragLeave,
    handleAttachmentDrop,
    resetAttachments,
  }
}
