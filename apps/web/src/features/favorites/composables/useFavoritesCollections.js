import { computed, ref } from 'vue'
import notificationService from '@/services/notification'

export function useFavoritesCollections({ favoritesStore }) {
  const showCollectionModal = ref(false)
  const editingCollection = ref(null)
  const isEditingCollection = ref(false)

  const collectionSubtitle = computed(() => {
    if (favoritesStore.selectedCollection?.description) {
      return favoritesStore.selectedCollection.description
    }
    return favoritesStore.selectedCollection
      ? '当前合集'
      : `${favoritesStore.collectionsCount} 个合集`
  })

  const favoritesCount = computed(() => {
    return favoritesStore.selectedCollection
      ? favoritesStore.collectionFavorites.length
      : favoritesStore.favoritesCount
  })

  const currentCollectionName = computed(() => {
    return favoritesStore.selectedCollection ? favoritesStore.selectedCollection.name : '全部收藏'
  })

  const currentCollectionIcon = computed(() => {
    return favoritesStore.selectedCollection
      ? `bi-${favoritesStore.selectedCollection.icon || 'folder'}`
      : 'bi-heart-fill'
  })

  const railCollections = computed(() => {
    return [...favoritesStore.collections].sort((a, b) => {
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0)
    })
  })

  function getRailCollectionCount(collection) {
    if (!collection?.id) return 0
    return favoritesStore.favorites.filter((item) => {
      return Array.isArray(item.collections) && item.collections.includes(collection.id)
    }).length
  }

  function openCreateCollectionModal() {
    isEditingCollection.value = false
    editingCollection.value = null
    showCollectionModal.value = true
  }

  function openEditCollectionModal(collection) {
    isEditingCollection.value = true
    editingCollection.value = collection
    showCollectionModal.value = true
  }

  function closeCollectionModal() {
    showCollectionModal.value = false
    setTimeout(() => {
      editingCollection.value = null
      isEditingCollection.value = false
    }, 220)
  }

  function saveCollection(collectionData) {
    try {
      let result

      if (isEditingCollection.value && editingCollection.value) {
        result = favoritesStore.updateCollection(editingCollection.value.id, collectionData)

        if (result.success) {
          notificationService.success(`集合 "${collectionData.name}" 已更新`, {
            duration: 3000,
            position: 'top-right',
          })
        } else {
          notificationService.error(result.message || '更新集合失败', {
            duration: 3000,
            position: 'top-right',
          })
        }
      } else {
        result = favoritesStore.createCollection(
          collectionData.name,
          collectionData.description,
          collectionData.icon,
        )

        if (result.success) {
          notificationService.success(`集合 "${collectionData.name}" 已创建`, {
            duration: 3000,
            position: 'top-right',
          })
        } else {
          notificationService.error(result.message || '创建集合失败', {
            duration: 3000,
            position: 'top-right',
          })
        }
      }
    } catch (error) {
      console.error('保存集合失败:', error)
      notificationService.error('操作失败，请重试', {
        duration: 3000,
        position: 'top-right',
      })
    }
  }

  function deleteCollection(collection) {
    try {
      const result = favoritesStore.deleteCollection(collection.id)

      if (result.success) {
        notificationService.success(`集合 "${collection.name}" 已删除`, {
          duration: 3000,
          position: 'top-right',
        })
      } else {
        notificationService.error(result.message || '删除集合失败', {
          duration: 3000,
          position: 'top-right',
        })
      }
    } catch (error) {
      console.error('删除集合失败:', error)
      notificationService.error('操作失败，请重试', {
        duration: 3000,
        position: 'top-right',
      })
    }
  }

  function selectCollection(collection) {
    favoritesStore.selectCollection(collection)
  }

  return {
    showCollectionModal,
    editingCollection,
    isEditingCollection,
    collectionSubtitle,
    favoritesCount,
    currentCollectionName,
    currentCollectionIcon,
    railCollections,
    getRailCollectionCount,
    openCreateCollectionModal,
    openEditCollectionModal,
    closeCollectionModal,
    saveCollection,
    deleteCollection,
    selectCollection,
  }
}
