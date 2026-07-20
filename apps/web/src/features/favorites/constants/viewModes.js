export const FAVORITES_VIEW_MODES = [
  { key: 'grid', label: '网格', icon: 'bi-grid-3x3-gap' },
  { key: 'network', label: '关系网', icon: 'bi-diagram-3' },
  { key: 'orbs', label: '球球', icon: 'bi-circle-fill' },
  { key: 'stats', label: '统计', icon: 'bi-bar-chart' },
]

export const FAVORITES_GRID_VIEWS = [
  {
    key: 'standard',
    label: '标准网格',
    shortLabel: '标准',
    icon: 'bi-grid-3x3-gap',
    columns: 4,
    ratioMode: 'square',
    showTags: true,
    showUploader: true,
  },
  {
    key: 'gallery',
    label: '画廊大图',
    shortLabel: '画廊',
    icon: 'bi-columns-gap',
    columns: 3,
    ratioMode: 'original',
    showTags: true,
    showUploader: true,
  },
  {
    key: 'compact',
    label: '紧凑网格',
    shortLabel: '紧凑',
    icon: 'bi-grid-fill',
    columns: 6,
    ratioMode: 'square',
    showTags: false,
    showUploader: false,
  },
  {
    key: 'cinema',
    label: '宽幅浏览',
    shortLabel: '宽幅',
    icon: 'bi-aspect-ratio',
    columns: 2,
    ratioMode: 'original',
    showTags: false,
    showUploader: true,
  },
]
