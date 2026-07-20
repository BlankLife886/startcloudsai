export const sections = [
  {
    id: 'general',
    label: '基础与账号',
    icon: 'bi-person-gear',
    title: '基础与账号',
    description: '管理 Wallhaven 授权、NSFW 显示与账号级偏好。',
  },
  {
    id: 'browsing',
    label: '浏览与搜索',
    icon: 'bi-search',
    title: '浏览与搜索',
    description: '预设常用搜索条件、结果布局和搜索页滚动交互。',
  },
  {
    id: 'visuals',
    label: '视觉与预览',
    icon: 'bi-palette2',
    title: '视觉与预览',
    description: '统一管理卡片画质、全屏预览、悬停工具和页面动效。',
  },
  {
    id: 'download',
    label: '下载',
    icon: 'bi-download',
    title: '下载',
    description: '配置壁纸下载和多张打包行为。',
  },
  {
    id: 'data',
    label: '数据',
    icon: 'bi-database',
    title: '数据与同步',
    description: '本地存储、云端同步、备份导入与数据清理。',
  },
  {
    id: 'performance',
    label: '性能',
    icon: 'bi-speedometer2',
    title: '性能',
    description: '缓存策略、画质上限与页面性能相关选项。',
  },
]

export const searchCategoryDefaults = [
  { value: '111', label: '全类型' },
  { value: '100', label: '普通' },
  { value: '010', label: '动漫' },
  { value: '001', label: '人物' },
  { value: '011', label: '动漫 + 人物' },
  { value: '110', label: '普通 + 动漫' },
]

export const searchPurityDefaults = [
  { value: '100', label: '健康' },
  { value: '010', label: '仅擦边' },
  { value: '001', label: '仅 NSFW' },
  { value: '110', label: '健康 + 擦边' },
  { value: '011', label: '擦边 + NSFW' },
  { value: '111', label: '全部' },
]

export const searchResolutionOptions = [
  { value: '', label: '任意' },
  { value: '3840x2160', label: '4K' },
  { value: '2560x1440', label: '2K' },
  { value: '1920x1080', label: 'FHD' },
  { value: '1366x768', label: '1366x768' },
  { value: '1280x720', label: 'HD' },
]

export const searchRatioOptions = [
  { value: '', label: '任意' },
  { value: '16x9', label: '16:9' },
  { value: '16x10', label: '16:10' },
  { value: '21x9', label: '21:9' },
  { value: '32x9', label: '32:9' },
  { value: '48x9', label: '48:9' },
  { value: '9x16', label: '9:16' },
  { value: '10x16', label: '10:16' },
  { value: '19x9', label: '19:9' },
  { value: '19x10', label: '19:10' },
  { value: '20x9', label: '20:9' },
  { value: '1x1', label: '1:1' },
]

export const searchSortingOptions = [
  { value: 'relevance', label: '相关' },
  { value: 'date_added', label: '最新' },
  { value: 'views', label: '浏览' },
  { value: 'favorites', label: '收藏' },
  { value: 'toplist', label: '热门' },
  { value: 'random', label: '随机' },
]

export const searchOrderOptions = [
  { value: 'desc', label: '降序' },
  { value: 'asc', label: '升序' },
]

export const searchTopRangeOptions = [
  { value: '1d', label: '1天' },
  { value: '3d', label: '3天' },
  { value: '1w', label: '1周' },
  { value: '1M', label: '1个月' },
  { value: '3M', label: '3个月' },
  { value: '6M', label: '6个月' },
  { value: '1y', label: '1年' },
]

export const searchGridColumnOptions = [
  { value: 8, label: '8列' },
  { value: 6, label: '6列' },
  { value: 4, label: '4列' },
  { value: 3, label: '3列' },
  { value: 2, label: '2列' },
]

export const searchColorOptions = [
  { value: '', label: '任意颜色' },
  { value: '660000', label: '深红 #660000' },
  { value: '990000', label: '暗红 #990000' },
  { value: 'cc0000', label: '红色 #cc0000' },
  { value: 'cc3333', label: '浅红 #cc3333' },
  { value: 'ea4c88', label: '粉色 #ea4c88' },
  { value: '993399', label: '紫色 #993399' },
  { value: '663399', label: '深紫 #663399' },
  { value: '333399', label: '蓝紫 #333399' },
  { value: '0066cc', label: '蓝色 #0066cc' },
  { value: '0099cc', label: '青蓝 #0099cc' },
  { value: '66cccc', label: '浅青 #66cccc' },
  { value: '77cc33', label: '浅绿 #77cc33' },
  { value: '669900', label: '绿色 #669900' },
  { value: '336600', label: '深绿 #336600' },
  { value: '666600', label: '橄榄 #666600' },
  { value: '999900', label: '黄绿 #999900' },
  { value: 'cccc33', label: '浅黄 #cccc33' },
  { value: 'ffff00', label: '黄色 #ffff00' },
  { value: 'ffcc33', label: '金色 #ffcc33' },
  { value: 'ff9900', label: '橙色 #ff9900' },
  { value: 'ff6600', label: '橘红 #ff6600' },
  { value: 'cc6633', label: '赤褐 #cc6633' },
  { value: '996633', label: '棕色 #996633' },
  { value: '663300', label: '深棕 #663300' },
  { value: '000000', label: '黑色 #000000' },
  { value: '999999', label: '灰色 #999999' },
  { value: 'cccccc', label: '浅灰 #cccccc' },
  { value: 'ffffff', label: '白色 #ffffff' },
  { value: '424153', label: '蓝灰 #424153' },
]

export const defaultFilterSelects = [
  {
    key: 'categories',
    label: '分类',
    model: 'search_default_categories',
    options: searchCategoryDefaults,
  },
  {
    key: 'purity',
    label: '纯度',
    model: 'search_default_purity',
    options: searchPurityDefaults,
  },
  {
    key: 'resolution',
    label: '分辨率',
    model: 'default_resolution',
    options: searchResolutionOptions,
  },
  {
    key: 'ratio',
    label: '比例',
    model: 'default_ratio',
    options: searchRatioOptions,
  },
  {
    key: 'sorting',
    label: '排序',
    model: 'default_sorting',
    options: searchSortingOptions,
  },
  {
    key: 'order',
    label: '顺序',
    model: 'default_order',
    options: searchOrderOptions,
  },
  {
    key: 'topRange',
    label: '热门范围',
    model: 'search_default_top_range',
    options: searchTopRangeOptions,
  },
  {
    key: 'gridColumns',
    label: '默认列数',
    model: 'search_default_grid_columns',
    options: searchGridColumnOptions,
  },
]

export const searchToolbarTools = [
  {
    key: 'search_toolbar_show_categories',
    label: '分类',
    icon: 'bi-tags',
    tooltip: '控制浏览壁纸顶部工具栏是否显示分类筛选',
  },
  {
    key: 'search_toolbar_show_purity',
    label: '纯度',
    icon: 'bi-shield-check',
    tooltip: '控制浏览壁纸顶部工具栏是否显示纯度筛选',
  },
  {
    key: 'search_toolbar_show_resolution',
    label: '分辨率',
    icon: 'bi-badge-4k',
    tooltip: '控制浏览壁纸顶部工具栏是否显示分辨率筛选',
  },
  {
    key: 'search_toolbar_show_ratio',
    label: '比例',
    icon: 'bi-aspect-ratio',
    tooltip: '控制浏览壁纸顶部工具栏是否显示比例筛选',
  },
  {
    key: 'search_toolbar_show_color',
    label: '颜色',
    icon: 'bi-palette',
    tooltip: '控制浏览壁纸顶部工具栏是否显示颜色筛选',
  },
  {
    key: 'search_toolbar_show_sorting',
    label: '排序',
    icon: 'bi-sort-down',
    tooltip: '控制浏览壁纸顶部工具栏是否显示排序选择',
  },
  {
    key: 'search_toolbar_show_top_range',
    label: '热门范围',
    icon: 'bi-calendar-range',
    tooltip: '控制浏览壁纸顶部工具栏是否显示热门时间范围',
  },
  {
    key: 'search_toolbar_show_order',
    label: '升降序',
    icon: 'bi-sort-down-alt',
    tooltip: '控制浏览壁纸顶部工具栏是否显示升序和降序切换',
  },
  {
    key: 'search_toolbar_show_grid',
    label: '网格列数',
    icon: 'bi-grid-3x3-gap',
    tooltip: '控制浏览壁纸顶部工具栏是否显示网格列数切换',
  },
  {
    key: 'search_toolbar_show_quality',
    label: '画质',
    icon: 'bi-image',
    tooltip: '控制浏览壁纸顶部工具栏是否显示图片画质切换',
  },
  {
    key: 'search_toolbar_show_download',
    label: '本页下载',
    icon: 'bi-download',
    tooltip: '控制浏览壁纸顶部工具栏是否显示本页下载按钮',
  },
  {
    key: 'search_toolbar_show_search',
    label: '搜索',
    icon: 'bi-search',
    tooltip: '控制浏览壁纸顶部工具栏是否显示搜索入口',
  },
  {
    key: 'search_toolbar_show_reset',
    label: '重置',
    icon: 'bi-arrow-counterclockwise',
    tooltip: '控制浏览壁纸顶部工具栏是否显示重置筛选按钮',
  },
]

export const searchDockTools = [
  {
    key: 'search_dock_show_summary',
    label: '摘要',
    icon: 'bi-card-text',
    tooltip: '控制底部悬浮栏是否显示当前结果摘要',
  },
  {
    key: 'search_dock_show_colors',
    label: '主色',
    icon: 'bi-palette',
    tooltip: '控制底部悬浮栏是否显示本页主色',
  },
  {
    key: 'search_dock_show_selection',
    label: '多选',
    icon: 'bi-check2-square',
    tooltip: '控制底部悬浮栏是否显示多选工具',
  },
  {
    key: 'search_dock_show_export_links',
    label: '导出链接',
    icon: 'bi-link-45deg',
    tooltip: '控制底部多选操作是否显示导出链接按钮',
  },
  {
    key: 'search_dock_show_pending',
    label: '加入待定',
    icon: 'bi-inbox',
    tooltip: '控制底部多选操作是否显示加入待定池按钮',
  },
  {
    key: 'search_dock_show_hide_selected',
    label: '隐藏所选',
    icon: 'bi-eye-slash',
    tooltip: '控制底部多选操作是否显示隐藏所选按钮',
  },
  {
    key: 'search_dock_show_compare',
    label: '对比',
    icon: 'bi-layout-three-columns',
    tooltip: '控制底部多选操作是否显示加入对比按钮',
  },
  {
    key: 'search_dock_show_collection',
    label: '进合集',
    icon: 'bi-folder-plus',
    tooltip: '控制底部多选操作是否显示进入合集按钮',
  },
  {
    key: 'search_dock_show_favorite',
    label: '收藏',
    icon: 'bi-heart',
    tooltip: '控制底部多选操作是否显示批量收藏按钮',
  },
  {
    key: 'search_dock_show_download',
    label: '下载',
    icon: 'bi-download',
    tooltip: '控制底部多选操作是否显示批量下载按钮',
  },
  {
    key: 'search_dock_show_hidden',
    label: '恢复隐藏',
    icon: 'bi-eye',
    tooltip: '控制底部悬浮栏是否显示恢复隐藏图片按钮',
  },
  {
    key: 'search_dock_show_jump',
    label: '页码跳转',
    icon: 'bi-box-arrow-in-right',
    tooltip: '控制底部悬浮栏是否显示页码跳转输入',
  },
  {
    key: 'search_dock_show_pager',
    label: '翻页',
    icon: 'bi-chevron-left',
    tooltip: '控制底部悬浮栏是否显示上一页和下一页按钮',
  },
  {
    key: 'search_dock_show_more',
    label: '加载更多',
    icon: 'bi-arrow-down-circle',
    tooltip: '控制底部悬浮栏是否显示手动加载更多按钮',
  },
]

export const visualSelects = [
  {
    key: 'previewQuality',
    label: '卡片画质',
    model: 'preview_image_quality',
    options: [
      { value: 'tiny', label: '极小' },
      { value: 'medium', label: '中等' },
      { value: 'high', label: '高清' },
      { value: 'original', label: '原图' },
    ],
  },
  {
    key: 'previewFit',
    label: '全屏模式',
    model: 'fullscreen_preview_fit_mode',
    options: [
      { value: 'contain', label: '完整显示' },
      { value: 'cover', label: '铺满显示' },
    ],
  },
  {
    key: 'revealStyle',
    label: '揭幕形式',
    model: 'image_reveal_style',
    options: [
      { value: 'mosaic', label: '马赛克格子' },
      { value: 'soft', label: '轻量淡入' },
      { value: 'blur', label: '渐进清晰 (GPT)' },
    ],
  },
  {
    key: 'revealStrength',
    label: '揭幕强度',
    model: 'image_reveal_strength',
    options: [
      { value: 'off', label: '关闭' },
      { value: 'medium', label: '中' },
      { value: 'epic', label: '电影感' },
    ],
  },
]

export const visualToggleTools = [
  {
    key: 'enable_animations',
    label: '全局动效',
    icon: 'bi-magic',
    tooltip: '控制页面切换、按钮和卡片的动画效果',
  },
  {
    key: 'sidebar_animation_effect',
    label: '导航动画',
    icon: 'bi-stars',
    tooltip: '控制侧边导航的高亮和过渡动画',
  },
  {
    key: 'enable_blur_effects',
    label: '模糊材质',
    icon: 'bi-layers',
    tooltip: '控制面板和浮层是否使用背景模糊效果',
  },
  {
    key: 'show_hover_preview',
    label: '高清悬停',
    icon: 'bi-zoom-in',
    tooltip: '控制壁纸卡片悬停时是否显示高清预览',
  },
  {
    key: 'show_card_action_toolbar',
    label: '卡片工具',
    icon: 'bi-tools',
    tooltip: '控制壁纸卡片上是否显示快捷操作工具栏',
  },
  {
    key: 'show_card_hide_button',
    label: '隐藏按钮',
    icon: 'bi-eye-slash',
    tooltip: '控制壁纸卡片上是否显示隐藏图片按钮',
  },
  {
    key: 'auto_play_videos',
    label: '视频自动播放',
    icon: 'bi-play-circle',
    tooltip: '控制视频类壁纸是否自动播放预览',
  },
]

export const downloadSaveModeSelect = {
  key: 'downloadSaveMode',
  label: '默认归类',
  model: 'save_mode',
  options: [
    { value: 'default', label: '不归类' },
    { value: 'resolution', label: '按分辨率' },
    { value: 'date', label: '按日期' },
    { value: 'custom', label: '自定义名称' },
  ],
}

export const downloadToggleTools = [
  {
    key: 'show_progress',
    label: '下载进度',
    icon: 'bi-activity',
    tooltip: '下载任务执行时显示进度反馈',
  },
  {
    key: 'batch_download_as_zip',
    label: '多张打包',
    icon: 'bi-file-zip',
    tooltip: '下载多张壁纸时生成一个压缩包；关闭后逐张交给浏览器下载',
  },
]

export const dataPerformanceTools = [
  {
    key: 'enable_lazy_loading',
    label: '延迟加载',
    icon: 'bi-hourglass-split',
    tooltip: '图片接近可视区域时再加载，减少首屏压力',
  },
  {
    key: 'performance_low_data_mode',
    label: '低流量',
    icon: 'bi-speedometer',
    tooltip: '限制卡片预览画质并关闭悬停预览，降低流量和渲染压力',
  },
  {
    key: 'clear_cache_on_exit',
    label: '退出清理',
    icon: 'bi-door-open',
    tooltip: '离开页面时清理站点临时缓存',
  },
]

export const performanceQualityCapSelect = {
  key: 'performanceQualityCap',
  label: '画质上限',
  model: 'performance_preview_quality_cap',
  options: [
    { value: 'tiny', label: '极小' },
    { value: 'medium', label: '中等' },
    { value: 'high', label: '高清' },
    { value: 'original', label: '不限' },
  ],
}
