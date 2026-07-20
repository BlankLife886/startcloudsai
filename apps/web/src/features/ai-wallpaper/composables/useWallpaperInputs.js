import {
  blobToDataUrl,
  getDisplayImageUrl,
  loadImageSize,
  nearestAspectLabel,
  uploadAiInputFile,
} from '@/services/aiWallpaper'
import { proxyWallhavenImageUrl, wallpaperApi } from '@/services/api'
import notificationService from '@/services/notification'
import { computed, ref, watch } from 'vue'
import {
  T2I_PROMPT_LIBRARY,
  WALLPAPER_INSPIRATION_PROMPTS,
  WALLPAPER_PROMPT_PRESETS,
  resolveT2iOutputSize,
} from './wallpaperStudioConstants.js'

export function useWallpaperInputs(deps = {}) {
  const {
    favoritesStore,
    historyStore,
    userStore,
    selectedSkills: _selectedSkills = ref([]),
    selectedMcpServers: _selectedMcpServers = ref([]),
    selectedOutputIndex = ref(0),
    canvasMode = ref('auto'),
    resetCanvasView = () => {},
    persistStudioDraft = () => {},
    notify = notificationService,
    pickerPageSize = 24,
  } = deps

  const inputMode = deps.inputMode || ref('text')
  const outputType = deps.outputType || ref('image')
  const prompt =
    deps.prompt ||
    ref('极光穿过玻璃城市上空，远处雪山泛着蓝紫色光，精致、干净、适合作为 4K 桌面壁纸')
  const promptPolishEnabled = deps.promptPolishEnabled || ref(false)
  const autoTranslateEnabled = deps.autoTranslateEnabled || ref(false)
  const transparentPngEnabled = deps.transparentPngEnabled || ref(false)
  const negativePrompt =
    deps.negativePrompt || ref('文字、水印、logo、低清、噪点、畸形结构、过度锐化')
  const aspectRatio = deps.aspectRatio || ref('1:1')
  const imageCount = deps.imageCount || ref(1)
  const imageQuality = deps.imageQuality || ref('standard')
  const resolutionScale = deps.resolutionScale || ref('1K')
  const upscaleOutputFormat = deps.upscaleOutputFormat || ref('auto')
  const duration = deps.duration || ref(5)
  const creativity = deps.creativity || ref(46)
  const styleStrength = deps.styleStrength || ref(58)
  const detailBoost = deps.detailBoost || ref(true)
  const privacyMode = deps.privacyMode || ref(true)
  const videoMotion = deps.videoMotion || ref(42)

  const selectedFile = deps.selectedFile || ref(null)
  const uploadPreview = deps.uploadPreview || ref('')
  const uploadRemoteUrl = deps.uploadRemoteUrl || ref('')
  const uploadSize = deps.uploadSize || ref({ width: 0, height: 0 })
  const pastedFiles = deps.pastedFiles || ref([])
  const styleReferencePreviews = deps.styleReferencePreviews || ref([])
  const referenceImages = deps.referenceImages || ref([])

  const siteQuery = deps.siteQuery || ref('')
  const siteWallpapers = deps.siteWallpapers || ref([])
  const sitePage = deps.sitePage || ref(1)
  const siteLastPage = deps.siteLastPage || ref(1)
  const siteTotal = deps.siteTotal || ref(0)
  const siteSorting = deps.siteSorting || ref('favorites')
  const siteOrder = deps.siteOrder || ref('desc')
  const siteCategory = deps.siteCategory || ref('111')
  const siteRatio = deps.siteRatio || ref('')
  const selectedWallpaper = deps.selectedWallpaper || ref(null)
  const sourceImageCandidates = deps.sourceImageCandidates || ref([])
  const sourceImageCandidateIndex = deps.sourceImageCandidateIndex || ref(0)
  const siteLoading = deps.siteLoading || ref(false)
  const sourcePickerOpen = deps.sourcePickerOpen || ref(false)
  const sourcePickerMode = deps.sourcePickerMode || ref('site')
  const siteLibraryTab = deps.siteLibraryTab || ref('favorites')
  const pickerPageInput = deps.pickerPageInput || ref('1')
  const sourcePurityFilters = deps.sourcePurityFilters || ref(['sfw', 'sketchy', 'nsfw'])
  const authorQuery = deps.authorQuery || ref('')
  const activeAuthor = deps.activeAuthor || ref('')

  const promptPresets = WALLPAPER_PROMPT_PRESETS
  const promptLibrary = T2I_PROMPT_LIBRARY
  const inspirationPrompts = WALLPAPER_INSPIRATION_PROMPTS
  const outputSizeLabel = computed(() =>
    resolveT2iOutputSize(aspectRatio.value, resolutionScale.value),
  )

  const sourcePreview = computed(() => {
    if (inputMode.value === 'upload') return uploadPreview.value
    if (inputMode.value === 'site')
      return sourceImageCandidates.value[sourceImageCandidateIndex.value] || ''
    return ''
  })
  const sourceRemoteUrl = computed(() => {
    if (inputMode.value === 'upload') return uploadRemoteUrl.value
    if (inputMode.value === 'site')
      return selectedWallpaper.value ? getWallpaperRemoteFullSource(selectedWallpaper.value) : ''
    return ''
  })
  const sourceLabel = computed(() => {
    if (inputMode.value === 'upload' && selectedFile.value) return selectedFile.value.name
    if (inputMode.value === 'site' && selectedWallpaper.value) {
      const width = selectedWallpaper.value.dimension_x || selectedWallpaper.value.width
      const height = selectedWallpaper.value.dimension_y || selectedWallpaper.value.height
      return `${selectedWallpaper.value.id || '本站壁纸'}${width && height ? ` · ${width}x${height}` : ''}`
    }
    if (inputMode.value === 'text') return '纯提示词生成'
    return '请选择参考图片'
  })
  const favoriteSourceItems = computed(() => favoritesStore?.getRecentFavorites?.(240) || [])
  const filteredFavoriteSourceItems = computed(() =>
    favoriteSourceItems.value.filter((item) =>
      sourcePurityFilters.value.includes(normalizePickerPurity(item)),
    ),
  )
  const historySourceItems = computed(() => historyStore?.getRecentHistory?.(240) || [])
  const filteredHistorySourceItems = computed(() =>
    historySourceItems.value.filter((item) =>
      sourcePurityFilters.value.includes(normalizePickerPurity(item)),
    ),
  )
  const followedAuthorItems = computed(() => (userStore?.followedUsers || []).slice(0, 24))
  const pickerTotal = computed(() => {
    if (siteLibraryTab.value === 'favorites') return filteredFavoriteSourceItems.value.length
    if (siteLibraryTab.value === 'history') return filteredHistorySourceItems.value.length
    return siteTotal.value || siteWallpapers.value.length
  })
  const pickerLastPage = computed(() => {
    if (siteLibraryTab.value === 'browse' || siteLibraryTab.value === 'authors') {
      return Math.max(1, siteLastPage.value || 1)
    }
    return Math.max(1, Math.ceil(pickerTotal.value / pickerPageSize))
  })
  const pickerSiteItems = computed(() => {
    if (siteLibraryTab.value === 'favorites')
      return paginateLocalPickerItems(filteredFavoriteSourceItems.value)
    if (siteLibraryTab.value === 'history')
      return paginateLocalPickerItems(filteredHistorySourceItems.value)
    return siteWallpapers.value.slice(0, pickerPageSize)
  })
  const pickerDisplayItems = computed(() =>
    pickerSiteItems.value.map((wallpaper) => {
      const source = sourceThumb(wallpaper)
      return {
        raw: wallpaper,
        id: wallpaper.id,
        pickerKey: wallpaper.id || wallpaper.path || wallpaper.url || wallpaper.thumbnail || source,
        pickerSource: source,
        pickerMeta: sourceMeta(wallpaper),
      }
    }),
  )
  const pickerEmptyText = computed(() => {
    if (siteLibraryTab.value === 'favorites') return '还没有收藏壁纸'
    if (siteLibraryTab.value === 'history') return '还没有浏览记录'
    if (siteLibraryTab.value === 'authors') return '选择关注作者或搜索作者名'
    return siteLoading.value ? '正在搜索' : '没有找到壁纸'
  })

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    await setUploadSource(file)
    if (event.target) event.target.value = ''
  }

  async function addReferenceFiles(files) {
    const incoming = Array.from(files || []).filter((file) => file?.type?.startsWith('image/'))
    if (!incoming.length) return
    const remaining = Math.max(0, 4 - referenceImages.value.length)
    if (!remaining) {
      notify.warning('最多添加 4 张参考图')
      return
    }
    const accepted = incoming.slice(0, remaining)
    const additions = await Promise.all(
      accepted.map(async (file) => ({
        id: `file-${crypto.randomUUID()}`,
        file,
        url: '',
        preview: await blobToDataUrl(file),
        label: file.name || '本地参考图',
      })),
    )
    referenceImages.value = [...referenceImages.value, ...additions]
    if (incoming.length > accepted.length) notify.info('已达到 4 张参考图上限')
  }

  function addReferenceImageFromUrl(url, label = '生成作品') {
    const normalized = String(url || '').trim()
    if (!normalized) return false
    if (referenceImages.value.some((item) => item.url === normalized || item.preview === normalized)) {
      notify.info('这张图片已经在参考图中')
      return false
    }
    if (referenceImages.value.length >= 4) {
      notify.warning('最多添加 4 张参考图')
      return false
    }
    referenceImages.value = [
      ...referenceImages.value,
      {
        id: `remote-${crypto.randomUUID()}`,
        file: null,
        url: normalized,
        preview: normalized,
        label: String(label || '生成作品').slice(0, 80),
      },
    ]
    notify.success('已添加为参考图')
    return true
  }

  function removeReferenceImage(id) {
    referenceImages.value = referenceImages.value.filter((item) => item.id !== id)
  }

  function clearUploadSource() {
    selectedFile.value = null
    uploadPreview.value = ''
    uploadRemoteUrl.value = ''
    uploadSize.value = { width: 0, height: 0 }
    pastedFiles.value = []
    styleReferencePreviews.value = []
    inputMode.value = 'text'
    persistStudioDraft({ immediate: true })
  }

  async function setUploadSource(file) {
    if (!file.type.startsWith('image/')) {
      notify.warning('请选择图片文件')
      return
    }
    inputMode.value = 'upload'
    selectedFile.value = file
    uploadRemoteUrl.value = ''
    uploadPreview.value = await blobToDataUrl(file)
    pastedFiles.value = []
    styleReferencePreviews.value = []
    uploadSize.value = await loadImageSize(uploadPreview.value)
    aspectRatio.value = nearestAspectLabel(uploadSize.value.width, uploadSize.value.height)
    selectedOutputIndex.value = 0
    canvasMode.value = 'source'
    resetCanvasView({ keepFit: true })
    sourcePickerOpen.value = false
    try {
      uploadRemoteUrl.value = await uploadAiInputFile(file)
      persistStudioDraft({ immediate: true })
    } catch (error) {
      notify.warning(error?.message || '参考图上传失败，生成前会再次尝试')
    }
  }

  async function ensureUploadUrl() {
    if (inputMode.value !== 'upload') return sourceRemoteUrl.value
    if (uploadRemoteUrl.value) return uploadRemoteUrl.value
    if (!selectedFile.value) throw new Error('请先选择输入图')
    uploadRemoteUrl.value = await uploadAiInputFile(selectedFile.value)
    return uploadRemoteUrl.value
  }

  async function searchSiteWallpapers(autoSelect = true) {
    inputMode.value = 'site'
    siteLoading.value = true
    try {
      const query = siteQuery.value.trim()
      const response = await wallpaperApi.search({
        ...(query ? { q: query } : {}),
        categories: siteCategory.value,
        purity: selectedSourcePurityValue(),
        sorting: siteSorting.value,
        order: siteOrder.value,
        ratios: siteRatio.value,
        page: sitePage.value,
        per_page: pickerPageSize,
      })
      if (!response.success) throw new Error(response.error || '站内壁纸搜索失败')
      siteWallpapers.value = response.images || []
      siteLastPage.value = Number(response.meta?.last_page || response.meta?.lastPage || 1) || 1
      siteTotal.value = Number(response.meta?.total || siteWallpapers.value.length) || 0
      if (autoSelect && siteWallpapers.value[0]) selectSiteWallpaper(siteWallpapers.value[0])
    } catch (error) {
      notify.error(error?.message || '站内壁纸搜索失败')
    } finally {
      siteLoading.value = false
    }
  }

  function resetSitePageAndSearch() {
    sitePage.value = 1
    syncPickerPageInput()
    searchSiteWallpapers(false)
  }

  function changeSitePage(delta) {
    const next = Math.min(Math.max(1, sitePage.value + delta), pickerLastPage.value || 1)
    if (next === sitePage.value) return
    sitePage.value = next
    syncPickerPageInput()
    if (siteLibraryTab.value === 'browse' || siteLibraryTab.value === 'authors')
      searchSiteWallpapers(false)
  }

  function jumpPickerPage() {
    const next = Math.min(
      Math.max(1, Number.parseInt(pickerPageInput.value, 10) || 1),
      pickerLastPage.value,
    )
    if (next === sitePage.value) {
      syncPickerPageInput()
      return
    }
    sitePage.value = next
    syncPickerPageInput()
    if (siteLibraryTab.value === 'browse' || siteLibraryTab.value === 'authors')
      searchSiteWallpapers(false)
  }

  function syncPickerPageInput() {
    pickerPageInput.value = String(sitePage.value)
  }

  function paginateLocalPickerItems(items) {
    const start = (sitePage.value - 1) * pickerPageSize
    return items.slice(start, start + pickerPageSize)
  }

  function normalizePickerPurity(item = {}) {
    const purity = String(item.purity || '').toLowerCase()
    if (purity === '100' || purity === 'sfw') return 'sfw'
    if (purity === '110' || purity === 'sketchy') return 'sketchy'
    if (
      purity === '001' ||
      purity === '010' ||
      purity === '011' ||
      purity === '101' ||
      purity === 'nsfw'
    ) {
      return 'nsfw'
    }
    return 'sfw'
  }

  function selectedSourcePurityValue() {
    const selected = sourcePurityFilters.value
    return ['sfw', 'sketchy', 'nsfw']
      .map((purity) => (selected.includes(purity) ? '1' : '0'))
      .join('')
  }

  function toggleSourcePurity(purity) {
    const next = sourcePurityFilters.value.includes(purity)
      ? sourcePurityFilters.value.filter((item) => item !== purity)
      : [...sourcePurityFilters.value, purity]
    sourcePurityFilters.value = next.length ? next : [purity]
    sitePage.value = 1
    syncPickerPageInput()
    if (siteLibraryTab.value === 'browse' || siteLibraryTab.value === 'authors')
      searchSiteWallpapers(false)
  }

  async function selectSiteWallpaper(wallpaper, { resolveDetails = true } = {}) {
    selectedWallpaper.value = wallpaper
    inputMode.value = 'site'
    sourceImageCandidateIndex.value = 0
    sourceImageCandidates.value = getWallpaperFullCandidates(wallpaper)
    pastedFiles.value = []
    styleReferencePreviews.value = []
    selectedOutputIndex.value = 0
    canvasMode.value = 'source'
    resetCanvasView({ keepFit: true })
    aspectRatio.value = nearestAspectLabel(
      wallpaper?.dimension_x || wallpaper?.width,
      wallpaper?.dimension_y || wallpaper?.height,
    )
    if (resolveDetails && wallpaper?.id) {
      resolveSelectedWallpaperDetails(wallpaper.id)
    }
  }

  function openSourcePicker(mode = 'site') {
    sourcePickerMode.value = mode === 'text' || mode === 'upload' ? mode : 'site'
    sourcePickerOpen.value = true
    syncPickerPageInput()
    if (
      sourcePickerMode.value === 'site' &&
      siteLibraryTab.value === 'browse' &&
      !siteWallpapers.value.length
    ) {
      searchSiteWallpapers(false)
    }
  }

  function closeSourcePicker() {
    sourcePickerOpen.value = false
  }

  function openTextSourcePicker() {
    sourcePickerMode.value = 'text'
    sourcePickerOpen.value = true
  }

  function confirmTextSource() {
    inputMode.value = 'text'
    selectedWallpaper.value = null
    sourceImageCandidates.value = []
    sourceImageCandidateIndex.value = 0
    uploadPreview.value = ''
    uploadRemoteUrl.value = ''
    selectedFile.value = null
    pastedFiles.value = []
    styleReferencePreviews.value = []
    resetCanvasView({ keepFit: true })
    sourcePickerOpen.value = false
  }

  function pickSiteSource(wallpaper) {
    selectSiteWallpaper(wallpaper)
    sourcePickerOpen.value = false
  }

  async function resolveSelectedWallpaperDetails(id) {
    try {
      const response = await wallpaperApi.getWallpaperDetails(id)
      if (!response.success || !response.image) return
      if (String(selectedWallpaper.value?.id || '') !== String(id)) return
      selectedWallpaper.value = {
        ...selectedWallpaper.value,
        ...response.image,
      }
      sourceImageCandidateIndex.value = 0
      sourceImageCandidates.value = getWallpaperFullCandidates(selectedWallpaper.value)
    } catch {
      /* 详情失败时沿用已有搜索结果与候选图 */
    }
  }

  function handleSourcePreviewError() {
    if (inputMode.value !== 'site') return
    if (sourceImageCandidateIndex.value < sourceImageCandidates.value.length - 1) {
      sourceImageCandidateIndex.value += 1
    }
  }

  async function searchAuthorWallpapers(author = '') {
    const name = String(author || authorQuery.value || '').trim()
    if (!name) {
      notify.warning('请输入作者名')
      return
    }
    activeAuthor.value = name
    siteQuery.value = `@${name}`
    await searchSiteWallpapers(false)
  }

  function sourceThumb(wallpaper) {
    return getWallpaperThumbSource(wallpaper) || getDisplayImageUrl(wallpaper)
  }

  function sourceMeta(wallpaper) {
    const width = wallpaper?.dimension_x || wallpaper?.width
    const height = wallpaper?.dimension_y || wallpaper?.height
    if (width && height) return `${width}x${height}`
    return wallpaper?.category || wallpaper?.source || 'Wallpaper'
  }

  function getWallpaperFullSource(wallpaper = {}) {
    return getWallpaperFullCandidates(wallpaper)[0] || ''
  }

  function getWallpaperFullCandidates(wallpaper = {}) {
    return normalizeWallpaperSourceCandidates(getWallpaperRemoteFullCandidates(wallpaper), {
      proxy: true,
    })
  }

  function getWallpaperRemoteFullSource(wallpaper = {}) {
    return getWallpaperRemoteFullCandidates(wallpaper)[0] || ''
  }

  function getWallpaperRemoteFullCandidates(wallpaper = {}) {
    if (!wallpaper || typeof wallpaper !== 'object') return []
    return normalizeWallpaperSourceCandidates([
      wallpaper.raw_path,
      wallpaper.path,
      wallpaper.org,
      wallpaper.original,
      wallpaper.image_url,
      wallpaper.url,
      wallpaper.full,
      wallpaper.full_url,
      wallpaper.fullUrl,
      wallpaper.raw_thumbs?.original,
      wallpaper.thumbs?.original,
      ...buildWallhavenFullUrlCandidates(wallpaper),
    ])
  }

  function normalizeWallpaperSourceCandidates(candidates = [], { proxy = false } = {}) {
    const seen = new Set()
    return candidates
      .filter(Boolean)
      .map((url) => (proxy ? proxyWallhavenImageUrl(String(url)) : String(url)))
      .filter((url) => {
        if (!url || seen.has(url)) return false
        seen.add(url)
        return true
      })
  }

  function getWallpaperThumbSource(wallpaper = {}) {
    return (
      wallpaper.raw_thumbs?.large ||
      wallpaper.thumbs?.large ||
      wallpaper.raw_thumbnail ||
      wallpaper.thumbnail ||
      wallpaper.raw_thumbs?.original ||
      wallpaper.thumbs?.original ||
      getWallpaperFullSource(wallpaper) ||
      ''
    )
  }

  function buildWallhavenFullUrl(wallpaper = {}) {
    return buildWallhavenFullUrlCandidates(wallpaper)[0] || ''
  }

  function buildWallhavenFullUrlCandidates(wallpaper = {}) {
    const id = String(wallpaper.id || '').trim()
    if (!id) return []
    const prefix = id.slice(0, 2)
    return [
      `https://w.wallhaven.cc/full/${prefix}/wallhaven-${id}.jpg`,
      `https://w.wallhaven.cc/full/${prefix}/wallhaven-${id}.png`,
    ]
  }

  function composePrompt() {
    const userPrompt = String(prompt.value || '').trim()
    if (
      !userPrompt ||
      (!promptPolishEnabled.value && !autoTranslateEnabled.value && !transparentPngEnabled.value)
    ) {
      return userPrompt
    }

    const instructions = []
    if (autoTranslateEnabled.value) {
      instructions.push(
        'Silently translate any non-English intent into concise, natural English before interpreting it.',
      )
    }
    if (promptPolishEnabled.value) {
      instructions.push(
        'Silently enhance the visual prompt with coherent composition, lighting, materials, atmosphere and camera language while preserving the original subject and intent.',
      )
    }
    if (transparentPngEnabled.value) {
      instructions.push(
        'Return a real transparent PNG with an actual alpha channel. Use smooth anti-aliased contours, clean subpixel alpha coverage, crisp vector-like silhouette edges, and enough transparent padding around the subject. Never draw a checkerboard, white backdrop, solid-color backdrop, frame, halo, matte fringe, or fake transparency pattern.',
      )
    }

    return [
      'Image-generation prompt processing instructions:',
      ...instructions.map((item) => `- ${item}`),
      '- Do not render these instructions as visible text. Generate the requested image directly.',
      '',
      'User prompt:',
      userPrompt,
    ].join('\n')
  }

  function applyPromptPreset(preset) {
    const text = String(preset || '').trim()
    if (!text) return
    const base = prompt.value.trim()
    prompt.value = base ? `${base}，${text}` : text
  }

  function applyPromptLibraryItem(item) {
    const text = String(item?.prompt || item || '').trim()
    if (!text) return
    prompt.value = text
  }

  function randomizePrompt() {
    const next = inspirationPrompts[Math.floor(Math.random() * inspirationPrompts.length)]
    prompt.value = next
  }

  async function copyText(text, successText = '已复制') {
    const value = String(text || '').trim()
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      notify.success(successText)
    } catch {
      notify.warning('复制失败')
    }
  }

  function clearPrompt() {
    prompt.value = ''
  }

  async function handlePaste(event) {
    const items = Array.from(event.clipboardData?.items || [])
    const files = items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean)
    if (!files.length) return
    event.preventDefault()
    pastedFiles.value = files
    styleReferencePreviews.value = await Promise.all(files.map((file) => blobToDataUrl(file)))
    await setUploadSource(files[0])
    if (files.length > 1) {
      prompt.value =
        `${prompt.value.trim()}\n参考其余 ${files.length - 1} 张图片的整体风格、配色和光影，更新第一张输入图片。`.trim()
    } else {
      prompt.value = `${prompt.value.trim()}\n参考粘贴图片的风格，更新我上传的图片。`.trim()
    }
    notify.success(`已粘贴 ${files.length} 张图片`)
  }

  function removeStyleReference(index) {
    const fileIndex = index + 1
    pastedFiles.value = pastedFiles.value.filter((_, itemIndex) => itemIndex !== fileIndex)
    styleReferencePreviews.value = styleReferencePreviews.value.filter(
      (_, itemIndex) => itemIndex !== fileIndex,
    )
    notify.success('已移除参考图')
  }

  function useOutputAsUpload(url) {
    if (!url) return
    inputMode.value = 'upload'
    uploadPreview.value = url
    uploadRemoteUrl.value = url
    selectedFile.value = null
    pastedFiles.value = []
    styleReferencePreviews.value = []
    selectedOutputIndex.value = 0
    canvasMode.value = 'source'
    resetCanvasView({ keepFit: true })
  }

  watch(siteLibraryTab, () => {
    sitePage.value = 1
    syncPickerPageInput()
    if (
      sourcePickerOpen.value &&
      sourcePickerMode.value === 'site' &&
      siteLibraryTab.value === 'browse' &&
      !siteWallpapers.value.length
    ) {
      searchSiteWallpapers(false)
    }
  })

  watch(pickerLastPage, (lastPage) => {
    if (sitePage.value <= lastPage) return
    sitePage.value = Math.max(1, lastPage)
    syncPickerPageInput()
  })

  return {
    inputMode,
    outputType,
    prompt,
    promptPolishEnabled,
    autoTranslateEnabled,
    transparentPngEnabled,
    negativePrompt,
    aspectRatio,
    imageCount,
    imageQuality,
    resolutionScale,
    upscaleOutputFormat,
    outputSizeLabel,
    duration,
    creativity,
    styleStrength,
    detailBoost,
    privacyMode,
    videoMotion,
    selectedFile,
    uploadPreview,
    uploadRemoteUrl,
    uploadSize,
    pastedFiles,
    styleReferencePreviews,
    referenceImages,
    addReferenceFiles,
    addReferenceImageFromUrl,
    removeReferenceImage,
    siteQuery,
    siteWallpapers,
    sitePage,
    siteLastPage,
    siteTotal,
    siteSorting,
    siteOrder,
    siteCategory,
    siteRatio,
    selectedWallpaper,
    sourceImageCandidates,
    sourceImageCandidateIndex,
    siteLoading,
    sourcePickerOpen,
    sourcePickerMode,
    siteLibraryTab,
    pickerPageInput,
    sourcePurityFilters,
    authorQuery,
    activeAuthor,
    promptPresets,
    promptLibrary,
    inspirationPrompts,
    sourcePreview,
    sourceRemoteUrl,
    sourceLabel,
    favoriteSourceItems,
    historySourceItems,
    followedAuthorItems,
    pickerTotal,
    pickerLastPage,
    pickerSiteItems,
    pickerDisplayItems,
    pickerEmptyText,
    handleFileChange,
    clearUploadSource,
    setUploadSource,
    ensureUploadUrl,
    searchSiteWallpapers,
    resetSitePageAndSearch,
    changeSitePage,
    jumpPickerPage,
    syncPickerPageInput,
    paginateLocalPickerItems,
    normalizePickerPurity,
    selectedSourcePurityValue,
    toggleSourcePurity,
    selectSiteWallpaper,
    openSourcePicker,
    closeSourcePicker,
    openTextSourcePicker,
    confirmTextSource,
    pickSiteSource,
    resolveSelectedWallpaperDetails,
    handleSourcePreviewError,
    searchAuthorWallpapers,
    sourceThumb,
    sourceMeta,
    getWallpaperFullSource,
    getWallpaperFullCandidates,
    getWallpaperRemoteFullSource,
    getWallpaperRemoteFullCandidates,
    normalizeWallpaperSourceCandidates,
    getWallpaperThumbSource,
    buildWallhavenFullUrl,
    buildWallhavenFullUrlCandidates,
    composePrompt,
    applyPromptPreset,
    applyPromptLibraryItem,
    randomizePrompt,
    copyText,
    clearPrompt,
    handlePaste,
    removeStyleReference,
    useOutputAsUpload,
  }
}
