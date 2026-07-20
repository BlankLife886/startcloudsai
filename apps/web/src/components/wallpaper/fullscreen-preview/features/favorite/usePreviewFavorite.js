import { ref } from 'vue'

// 收藏逻辑独立成 feature：主弹窗只关心“当前是否收藏”和“点击收藏按钮”。
export function usePreviewFavorite({ wallpaperRef, favoritesStore }) {
  const isFavorite = ref(false)

  function syncFavoriteState(wallpaper = wallpaperRef.value) {
    if (!wallpaper?.id) {
      isFavorite.value = false
      return
    }
    isFavorite.value = favoritesStore.isFavorited(wallpaper.id)
  }

  function toggleFavorite() {
    const wallpaper = wallpaperRef.value
    if (!wallpaper?.id) return

    if (isFavorite.value) {
      favoritesStore.removeFavorite(wallpaper.id)
      isFavorite.value = false
      return
    }

    favoritesStore.addFavorite(wallpaper)
    isFavorite.value = true
  }

  return {
    isFavorite,
    syncFavoriteState,
    toggleFavorite,
  }
}
