import { computed } from 'vue'
import { proxyWallhavenImageUrl } from '@/services/api'

function getWallpaperImageUrl(item) {
  const rawUrl =
    item?.thumbnail ||
    item?.thumbs?.small ||
    item?.thumbs?.large ||
    item?.thumbs?.original ||
    item?.path ||
    '/placeholder.svg'

  return proxyWallhavenImageUrl(rawUrl)
}

/** 封面条优先大图，便于框内居中裁切 */
function getWallpaperCoverUrl(item) {
  const rawUrl =
    item?.thumbs?.large ||
    item?.thumbnail ||
    item?.thumbs?.original ||
    item?.thumbs?.small ||
    item?.path ||
    '/placeholder.svg'

  return proxyWallhavenImageUrl(rawUrl)
}

function getWallpaperLabel(item) {
  return item?.id || item?.resolution || 'wallpaper'
}

function getWallpaperSummary(item) {
  return [item?.resolution, item?.category, item?.purity].filter(Boolean).join(' · ')
}

export function useFavoritesVisuals({ filteredFavorites }) {
  const orbWallpapers = computed(() => {
    const items = filteredFavorites.value
    const total = items.length
    if (total === 0) return []

    const size = Math.max(32, Math.min(84, 90 - Math.max(total - 8, 0) * 0.78))
    const gap = Math.max(7, size * 0.09)
    const ringStep = size + gap
    const positions = [
      {
        tx: '0px',
        ty: '0px',
        floatX: '0px',
        floatY: '0px',
        floatBackX: '0px',
        floatBackY: '0px',
        collisionX: '0px',
        collisionY: '0px',
      },
    ]
    let remaining = total - 1
    let placed = 1
    let ring = 1

    while (remaining > 0) {
      const radius = ring * ringStep
      const capacity = Math.max(1, Math.floor((Math.PI * 2 * radius) / (size + gap)))
      const count = Math.min(remaining, capacity)
      const angleOffset = ring % 2 === 0 ? Math.PI / count : -Math.PI / 2

      for (let i = 0; i < count; i += 1) {
        const angle = angleOffset + (i / count) * Math.PI * 2
        const floatAmplitude = Math.min(2.4, gap * 0.18)
        const collisionDistance = Math.min(10, 3.5 + ring * 1.2)

        positions.push({
          tx: `${Math.cos(angle) * radius}px`,
          ty: `${Math.sin(angle) * radius}px`,
          floatX: `${Math.cos(angle + 0.85) * floatAmplitude}px`,
          floatY: `${Math.sin(angle + 0.85) * floatAmplitude}px`,
          floatBackX: `${Math.cos(angle + 0.85) * -floatAmplitude * 0.55}px`,
          floatBackY: `${Math.sin(angle + 0.85) * -floatAmplitude * 0.55}px`,
          collisionX: `${Math.cos(angle) * collisionDistance}px`,
          collisionY: `${Math.sin(angle) * collisionDistance}px`,
        })
      }

      placed += count
      remaining = total - placed
      ring += 1
    }

    return items.map((item, index) => {
      const position = positions[index]
      return {
        item,
        size,
        tx: position.tx,
        ty: position.ty,
        floatX: position.floatX,
        floatY: position.floatY,
        floatBackX: position.floatBackX,
        floatBackY: position.floatBackY,
        collisionX: position.collisionX,
        collisionY: position.collisionY,
        delay: `-${(index % 10) * 0.28}s`,
        duration: `${6.8 + (index % 6) * 0.42}s`,
      }
    })
  })

  const orbStageSize = computed(() => {
    if (orbWallpapers.value.length === 0) return 560

    const maxDistance = orbWallpapers.value.reduce((max, orb) => {
      const x = Math.abs(Number.parseFloat(orb.tx) || 0)
      const y = Math.abs(Number.parseFloat(orb.ty) || 0)
      return Math.max(max, x, y)
    }, 0)
    const maxSize = Math.max(...orbWallpapers.value.map((orb) => Number(orb.size) || 0), 48)
    return Math.ceil(Math.max(560, maxDistance * 2 + maxSize * 2.8))
  })

  return {
    getWallpaperImageUrl,
    getWallpaperCoverUrl,
    getWallpaperLabel,
    getWallpaperSummary,
    orbWallpapers,
    orbStageSize,
  }
}
