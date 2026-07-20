<script setup>
import notificationService from '@/services/notification'
import LogoutConfirmDialog from '@/components/profile/LogoutConfirmDialog.vue'
import { createLoginRedirectQuery } from '@/services/authRedirect'
import { useAuthStore } from '@/stores/auth'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import { useSettingsStore } from '@/stores/settings'
import { useUserStore } from '@/stores/user'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  isEditing: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['save', 'cancel', 'edit'])

// 获取stores
const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const userStore = useUserStore()
const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()
const router = useRouter()

// 本地状态
const isSaving = ref(false)
const isLoggingOut = ref(false)
const showLogoutDialog = ref(false)
const avatarPreview = ref(null)
const showAvatarSelector = ref(false)
const defaultAvatars = [
  '/placeholder.svg?v=1',
  '/placeholder.svg?v=2',
  '/placeholder.svg?v=3',
  '/placeholder.svg?v=4',
  '/placeholder.svg?v=5',
  '/placeholder.svg?v=6',
  '/placeholder.svg?v=7',
  '/placeholder.svg?v=8',
]

// 用户信息表单
const userForm = ref({
  username: settingsStore.settings.username || '用户',
  bio: settingsStore.settings.bio || '这个用户很懒，什么都没有留下。',
  avatar_url: settingsStore.settings.avatar_url || '/placeholder.svg',
  location: settingsStore.settings.location || '',
  website: settingsStore.settings.website || '',
  public_profile_enabled: settingsStore.settings.public_profile_enabled !== false,
  social_links: {
    github: settingsStore.settings.social_links?.github || '',
    twitter: settingsStore.settings.social_links?.twitter || '',
    instagram: settingsStore.settings.social_links?.instagram || '',
  },
  theme_preference: settingsStore.settings.theme || 'matrix',
  display_name: settingsStore.settings.display_name || '',
})

// 计算属性
const favoritesCount = computed(() => favoritesStore.favoritesCount)
const collectionsCount = computed(() => favoritesStore.collections.length)
const historyCount = computed(() => historyStore.historyCount)
const followedUsersCount = computed(() => userStore.followedUsersCount)
const followedCollectionsCount = computed(() => userStore.followedCollectionsCount)
const profileDisplayName = computed(() => {
  return authStore.isAuthenticated
    ? authStore.displayName
    : userForm.value.display_name || userForm.value.username
})
const accountEmail = computed(() => authStore.user?.email || '')
const accountIdShort = computed(() => {
  const id = String(authStore.user?.id || '')
  return id ? `${id.slice(0, 8)}...${id.slice(-4)}` : ''
})
const accountRoleLabel = computed(() => {
  const role = String(authStore.user?.role || 'user')
  return role === 'admin' ? '管理员' : '登录用户'
})
const loginRoute = computed(() => ({
  name: 'auth',
  query: {
    ...createLoginRedirectQuery('/profile'),
    mode: 'login',
  },
}))
const joinDate = computed(() => {
  const date = new Date(settingsStore.settings.join_date || Date.now())
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
})

function syncFormFromSettings() {
  userForm.value = {
    username: settingsStore.settings.username || '用户',
    bio: settingsStore.settings.bio || '这个用户很懒，什么都没有留下。',
    avatar_url: settingsStore.settings.avatar_url || '/placeholder.svg',
    location: settingsStore.settings.location || '',
    website: settingsStore.settings.website || '',
    public_profile_enabled: settingsStore.settings.public_profile_enabled !== false,
    social_links: {
      github: settingsStore.settings.social_links?.github || '',
      twitter: settingsStore.settings.social_links?.twitter || '',
      instagram: settingsStore.settings.social_links?.instagram || '',
    },
    theme_preference: settingsStore.settings.theme || 'matrix',
    display_name: settingsStore.settings.display_name || '',
  }
  avatarPreview.value = userForm.value.avatar_url
}

function onEditModalKeydown(event) {
  if (event.key === 'Escape' && props.isEditing && !isSaving.value) cancelEdit()
}

watch(
  () => props.isEditing,
  (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      syncFormFromSettings()
      showAvatarSelector.value = false
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', onEditModalKeydown)
    } else {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onEditModalKeydown)
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onEditModalKeydown)
})

// 保存个人资料
async function saveProfile() {
  isSaving.value = true

  try {
    // 保存用户信息
    await settingsStore.updateSettings({
      username: userForm.value.username,
      bio: userForm.value.bio,
      avatar_url: userForm.value.avatar_url,
      location: userForm.value.location,
      website: userForm.value.website,
      public_profile_enabled: userForm.value.public_profile_enabled,
      social_links: userForm.value.social_links,
      display_name: userForm.value.display_name,
    })

    // 通知父组件保存成功
    showAvatarSelector.value = false
    emit('save')

    // 显示成功通知
    notificationService.success('个人资料已更新', {
      duration: 3000,
      position: 'bottom-right',
    })
  } catch (error) {
    console.error('保存个人资料失败:', error)
    notificationService.error('保存个人资料失败: ' + error.message, {
      duration: 5000,
      position: 'bottom-right',
    })
  } finally {
    isSaving.value = false
  }
}

// 取消编辑
function cancelEdit() {
  showAvatarSelector.value = false
  syncFormFromSettings()
  emit('cancel')
}

// 选择头像
function selectAvatar(url) {
  userForm.value.avatar_url = url
  showAvatarSelector.value = false
}

// 处理自定义头像URL输入
function handleAvatarUrlInput() {
  avatarPreview.value = userForm.value.avatar_url
}

function replaceProfileUrl() {
  if (typeof window === 'undefined') return
  if (window.location.pathname !== '/profile' || !window.location.search) return
  window.history.replaceState(window.history.state, '', '/profile')
}

function requestLogout() {
  if (isLoggingOut.value) return
  showLogoutDialog.value = true
}

async function confirmLogout() {
  if (isLoggingOut.value) return

  isLoggingOut.value = true
  try {
    const logoutResult = authStore.logout()
    replaceProfileUrl()
    showLogoutDialog.value = false
    await router
      .replace({
        name: 'auth',
        query: { ...createLoginRedirectQuery('/profile'), mode: 'login' },
      })
      .catch(() => {})
    const result = await logoutResult
    if (result?.remoteCleared === false) {
      notificationService.warning('本地已退出登录，服务端会话清理失败，请稍后重试。')
    } else {
      notificationService.success('已退出登录')
    }
  } catch (error) {
    notificationService.error(error?.message || '退出登录失败')
  } finally {
    isLoggingOut.value = false
  }
}

// 监听头像URL变化
watch(
  () => userForm.value.avatar_url,
  (newUrl) => {
    avatarPreview.value = newUrl
  },
)

// 初始化头像预览
avatarPreview.value = userForm.value.avatar_url
</script>

<template>
  <div class="user-profile-card">
    <div v-if="!isEditing" class="profile-card">
      <div class="profile-card-decoration"></div>

      <div class="profile-card-content">
        <div class="profile-header">
          <div class="avatar-section">
            <div class="avatar-container">
              <div class="avatar-frame">
                <img
                  :src="avatarPreview || userForm.avatar_url"
                  alt="用户头像"
                  class="profile-avatar"
                  @error="avatarPreview = '/placeholder.svg'"
                />
                <div class="avatar-glow"></div>
              </div>
            </div>
          </div>

          <div class="user-info-section">
            <div class="user-header">
              <div class="user-name-container">
                <h2 class="user-name">
                  {{ profileDisplayName }}
                </h2>
                <div
                  class="account-session"
                  :class="{ 'is-authenticated': authStore.isAuthenticated }"
                >
                  <i
                    class="bi"
                    :class="authStore.isAuthenticated ? 'bi-shield-check' : 'bi-person-lock'"
                  ></i>
                  <div>
                    <span>{{ authStore.isAuthenticated ? accountRoleLabel : '访客资料' }}</span>
                    <small v-if="authStore.isAuthenticated">
                      {{ accountEmail || accountIdShort || '已登录' }}
                    </small>
                    <small v-else>登录后同步收藏、历史与偏好信息</small>
                  </div>
                </div>
              </div>

              <div class="action-buttons">
                <button type="button" class="edit-profile-btn" @click="emit('edit')">
                  <i class="bi bi-pencil-fill"></i>
                  <span>编辑资料</span>
                </button>
                <RouterLink
                  v-if="!authStore.isAuthenticated"
                  :to="loginRoute"
                  class="profile-login-btn"
                >
                  <i class="bi bi-box-arrow-in-right"></i>
                  <span>登录</span>
                </RouterLink>
                <button
                  v-else
                  type="button"
                  class="profile-logout-btn"
                  :disabled="isLoggingOut || authStore.isLoading"
                  @click="requestLogout"
                >
                  <i class="bi bi-box-arrow-right"></i>
                  <span>{{ isLoggingOut || authStore.isLoading ? '退出中...' : '退出登录' }}</span>
                </button>
              </div>
            </div>

            <div class="user-bio-section">
              <div class="user-bio">
                <p>{{ userForm.bio }}</p>
              </div>
            </div>

            <div class="user-details-section">
              <div class="user-details">
                <div v-if="userForm.location" class="user-detail">
                  <i class="bi bi-geo-alt-fill"></i>
                  <span>{{ userForm.location }}</span>
                </div>
                <div v-if="userForm.website" class="user-detail">
                  <i class="bi bi-link-45deg"></i>
                  <a :href="userForm.website" target="_blank" rel="noopener noreferrer">{{
                    userForm.website
                  }}</a>
                </div>
                <div class="user-detail">
                  <i class="bi bi-calendar3"></i>
                  <span>加入于 {{ joinDate }}</span>
                </div>

                <!-- 社交链接 -->
                <div class="social-links">
                  <a
                    v-if="userForm.social_links.github"
                    :href="'https://github.com/' + userForm.social_links.github"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="social-link"
                  >
                    <i class="bi bi-github"></i>
                  </a>
                  <a
                    v-if="userForm.social_links.twitter"
                    :href="'https://twitter.com/' + userForm.social_links.twitter"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="social-link"
                  >
                    <i class="bi bi-twitter"></i>
                  </a>
                  <a
                    v-if="userForm.social_links.instagram"
                    :href="'https://instagram.com/' + userForm.social_links.instagram"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="social-link"
                  >
                    <i class="bi bi-instagram"></i>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 统计信息 -->
        <div class="user-stats-section">
          <div class="stats-container">
            <div class="stat-item">
              <div class="stat-value">{{ favoritesCount }}</div>
              <div class="stat-label">收藏</div>
              <i class="stat-icon bi bi-heart-fill"></i>
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ collectionsCount }}</div>
              <div class="stat-label">收藏夹</div>
              <i class="stat-icon bi bi-folder-fill"></i>
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ historyCount }}</div>
              <div class="stat-label">浏览</div>
              <i class="stat-icon bi bi-eye-fill"></i>
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ followedUsersCount }}</div>
              <div class="stat-label">关注</div>
              <i class="stat-icon bi bi-person-fill"></i>
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ followedCollectionsCount }}</div>
              <div class="stat-label">收藏合集</div>
              <i class="stat-icon bi bi-collection-fill"></i>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="isEditing"
        class="profile-edit-modal"
        @click.self="cancelEdit"
      >
        <div
          class="profile-edit-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-edit-title"
        >
          <header class="profile-edit-header">
            <div class="profile-edit-header__copy">
              <span class="profile-edit-kicker">Profile</span>
              <h3 id="profile-edit-title">编辑资料</h3>
              <p>更新头像、简介、公开主页与社交链接。</p>
            </div>
            <button
              type="button"
              class="modal-close-btn"
              @click="cancelEdit"
              :disabled="isSaving"
              aria-label="关闭"
            >
              <i class="bi bi-x-lg"></i>
            </button>
          </header>

          <div class="profile-edit-body">
            <section class="profile-edit-hero">
              <div class="profile-edit-hero__avatar">
                <img
                  :src="avatarPreview || userForm.avatar_url"
                  alt="用户头像"
                  @error="avatarPreview = '/placeholder.svg'"
                />
              </div>
              <div class="profile-edit-hero__meta">
                <strong>{{ userForm.display_name || userForm.username || '用户' }}</strong>
                <span>加入于 {{ joinDate }}</span>
              </div>
              <button
                type="button"
                class="avatar-edit-btn profile-edit-hero__action"
                @click="showAvatarSelector = !showAvatarSelector"
              >
                <i class="bi bi-camera-fill"></i>
                <span>{{ showAvatarSelector ? '收起头像选项' : '更换头像' }}</span>
              </button>

              <div v-if="showAvatarSelector" class="avatar-selector modal-avatar-selector">
                <div class="selector-header">
                  <h6>选择头像</h6>
                  <button type="button" class="close-btn" @click="showAvatarSelector = false">
                    <i class="bi bi-x"></i>
                  </button>
                </div>

                <div class="default-avatars">
                  <button
                    v-for="(avatar, index) in defaultAvatars"
                    :key="index"
                    type="button"
                    class="avatar-option"
                    :class="{ 'is-active': userForm.avatar_url === avatar }"
                    @click="selectAvatar(avatar)"
                  >
                    <img :src="avatar" alt="头像选项" />
                  </button>
                </div>

                <div class="custom-avatar-input">
                  <label class="form-label">自定义头像 URL</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="bi bi-link-45deg"></i></span>
                    <input
                      type="url"
                      class="form-control"
                      placeholder="https://..."
                      v-model="userForm.avatar_url"
                      @input="handleAvatarUrlInput"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section class="profile-edit-section">
              <h4 class="profile-edit-section__title">基本信息</h4>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="profile-display-name">显示名称</label>
                  <input
                    id="profile-display-name"
                    type="text"
                    class="form-control"
                    v-model="userForm.display_name"
                    placeholder="显示名称（可选）"
                  />
                </div>

                <div class="form-group">
                  <label class="form-label" for="profile-username">用户名</label>
                  <input
                    id="profile-username"
                    type="text"
                    class="form-control"
                    v-model="userForm.username"
                    placeholder="用户名"
                    required
                  />
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="profile-bio">个人简介</label>
                <textarea
                  id="profile-bio"
                  class="form-control"
                  v-model="userForm.bio"
                  rows="3"
                  placeholder="介绍一下自己..."
                ></textarea>
              </div>
            </section>

            <section class="profile-edit-section">
              <h4 class="profile-edit-section__title">公开设置</h4>
              <label class="public-profile-toggle">
                <input type="checkbox" v-model="userForm.public_profile_enabled" />
                <span>
                  <strong>公开星空云绘用户主页</strong>
                  <small>开启后，别人可以通过你的用户名看到公开资料、收藏画像和部分壁纸样本。</small>
                </span>
              </label>
            </section>

            <section class="profile-edit-section">
              <h4 class="profile-edit-section__title">链接与社交</h4>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="profile-location">位置</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="bi bi-geo-alt"></i></span>
                    <input
                      id="profile-location"
                      type="text"
                      class="form-control"
                      v-model="userForm.location"
                      placeholder="城市, 国家"
                    />
                  </div>
                </div>

                <div class="form-group">
                  <label class="form-label" for="profile-website">网站</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="bi bi-globe"></i></span>
                    <input
                      id="profile-website"
                      type="url"
                      class="form-control"
                      v-model="userForm.website"
                      placeholder="https://example.com"
                    />
                  </div>
                </div>
              </div>

              <div class="form-row social-edit">
                <div class="form-group">
                  <label class="form-label" for="profile-github">GitHub</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="bi bi-github"></i></span>
                    <input
                      id="profile-github"
                      type="text"
                      class="form-control"
                      v-model="userForm.social_links.github"
                      placeholder="用户名"
                    />
                  </div>
                </div>

                <div class="form-group">
                  <label class="form-label" for="profile-twitter">Twitter</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="bi bi-twitter"></i></span>
                    <input
                      id="profile-twitter"
                      type="text"
                      class="form-control"
                      v-model="userForm.social_links.twitter"
                      placeholder="用户名"
                    />
                  </div>
                </div>

                <div class="form-group">
                  <label class="form-label" for="profile-instagram">Instagram</label>
                  <div class="input-group">
                    <span class="input-group-text"><i class="bi bi-instagram"></i></span>
                    <input
                      id="profile-instagram"
                      type="text"
                      class="form-control"
                      v-model="userForm.social_links.instagram"
                      placeholder="用户名"
                    />
                  </div>
                </div>
              </div>
            </section>
          </div>

          <footer class="profile-edit-footer">
            <button type="button" class="cancel-btn" @click="cancelEdit" :disabled="isSaving">
              取消
            </button>
            <button type="button" class="save-btn" @click="saveProfile" :disabled="isSaving">
              <span v-if="isSaving" class="profile-edit-spinner" aria-hidden="true"></span>
              <i v-else class="bi bi-check-lg"></i>
              {{ isSaving ? '保存中…' : '保存更改' }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>

    <LogoutConfirmDialog
      v-model:open="showLogoutDialog"
      :loading="isLoggingOut"
      @confirm="confirmLogout"
    />
  </div>
</template>

<style scoped>
/* 卡片基础样式 */
.user-profile-card {
  margin-bottom: 0;
  min-width: 0;
}

.profile-card {
  background:
    linear-gradient(145deg, rgba(var(--primary-color-rgb), 0.16), rgba(255, 255, 255, 0.045) 42%),
    rgba(0, 0, 0, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  box-shadow: none;
  transition: all 0.4s ease;
}

.profile-card:hover {
  transform: none;
  border-color: rgba(var(--primary-color-rgb), 0.28);
}

/* 卡片装饰 */
.profile-card-decoration {
  position: absolute;
  inset: 0;
  display: block;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px);
  background-size: 24px 24px;
  opacity: 0.28;
  mask-image: linear-gradient(to bottom, #000, transparent 72%);
}

.profile-card-content {
  padding: 13px 12px 12px;
  position: relative;
  z-index: 2;
}

/* 个人资料头部 */
.profile-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 9px;
  margin-bottom: 8px;
}

/* 头像部分 */
.avatar-section {
  flex: 0 0 auto;
}

.avatar-container {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.avatar-frame {
  position: relative;
  width: 84px;
  height: 84px;
  border-radius: 22px;
  padding: 3px;
  background: linear-gradient(135deg, var(--primary-color), #54d6c4 55%, #f0c66a);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.24);
  transform: rotate(-3deg);
}

.profile-avatar {
  width: 100%;
  height: 100%;
  border-radius: 19px;
  object-fit: cover;
  border: 2px solid rgba(0, 0, 0, 0.48);
  transition: all 0.4s ease;
  transform: rotate(3deg);
}

.avatar-glow {
  display: none;
}

.avatar-edit-controls {
  margin-top: 10px;
  width: 100%;
}

.avatar-edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 8px 15px;
  border-radius: 0;
  background-color: rgba(106, 79, 224, 0.1);
  color: var(--pe-accent, #6a4fe0);
  border: 1px solid rgba(106, 79, 224, 0.28);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.avatar-edit-btn:hover {
  background-color: rgba(106, 79, 224, 0.16);
  transform: none;
}

.avatar-selector {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 280px;
  background-color: var(--card-bg-color);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  z-index: 100;
  margin-top: 15px;
  animation: fadeInUp 0.3s ease;
  border: none;
}

.selector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 15px;
  border-bottom: none;
}

.selector-header h6 {
  margin: 0;
  font-weight: 600;
  color: var(--text-color);
}

.close-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-color);
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background-color: rgba(var(--primary-color-rgb), 0.1);
  color: var(--primary-color);
}

.default-avatars {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 15px;
}

.avatar-option {
  cursor: pointer;
  border-radius: 50%;
  overflow: hidden;
  width: 50px;
  height: 50px;
  margin: 0 auto;
  border: none;
  transition: all 0.3s ease;
  box-shadow: none;
}

.avatar-option:hover {
  transform: scale(1.15);
  box-shadow: none;
}

.avatar-option img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.custom-avatar-input {
  padding: 0 15px 15px;
}

/* 用户信息部分 */
.user-info-section {
  width: 100%;
  min-width: 0;
  text-align: center;
}

.user-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  margin-bottom: 7px;
  justify-content: center;
  gap: 10px;
}

.user-name {
  font-size: 1.08rem;
  font-weight: 700;
  color: var(--text-color);
  margin: 0;
  line-height: 1.2;
  word-break: break-word;
  overflow-wrap: anywhere;
  text-align: center;
}

.account-session {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 9px;
  align-items: center;
  margin-top: 8px;
  padding: 8px 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  text-align: left;
}

.account-session.is-authenticated {
  background: rgba(84, 214, 196, 0.1);
  border-color: rgba(84, 214, 196, 0.24);
}

.account-session i {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: rgba(var(--primary-color-rgb), 0.18);
  color: #54d6c4;
}

.account-session span,
.account-session small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-session span {
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.82rem;
  font-weight: 700;
}

.account-session small {
  color: rgba(255, 255, 255, 0.62);
  font-size: 0.75rem;
  margin-top: 2px;
}

.name-edit-form {
  width: 100%;
}

.form-group {
  margin-bottom: 15px;
}

.form-label {
  display: block;
  margin-bottom: 6px;
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--pe-heading, var(--text-color));
  line-height: 1.2;
}

.form-control {
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 0;
  border: 1px solid var(--pe-line, rgba(21, 26, 45, 0.12));
  background-color: var(--pe-card, #ffffff) !important;
  color: var(--pe-heading, #151a2d) !important;
  caret-color: var(--pe-accent, #6a4fe0);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.form-control:focus {
  border-color: var(--pe-accent, #6a4fe0);
  background-color: var(--pe-card, #ffffff) !important;
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.18);
  outline: none;
}

.form-control::placeholder {
  color: var(--pe-muted, #79809a) !important;
  opacity: 1;
}

textarea.form-control {
  min-height: 92px;
  resize: vertical;
}

.input-group {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  min-width: 0;
}

.input-group-text {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  min-width: 40px;
  height: 40px;
  background-color: var(--pe-soft, rgba(106, 79, 224, 0.08)) !important;
  color: var(--pe-accent, #6a4fe0) !important;
  border: 1px solid var(--pe-line, rgba(21, 26, 45, 0.12));
  border-right: none;
  border-radius: 0;
}

.input-group .form-control {
  flex: 1 1 auto;
  width: 1%;
  min-width: 0;
  border-radius: 0;
  border-left: none !important;
}

.action-buttons {
  display: flex;
  gap: 8px;
  width: 100%;
  justify-content: stretch;
}

.edit-profile-btn,
.profile-login-btn,
.profile-logout-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  justify-content: center;
  min-height: 34px;
  padding: 7px 10px;
  border-radius: 8px;
  background: linear-gradient(
    135deg,
    rgba(var(--primary-color-rgb), 0.95),
    rgba(84, 214, 196, 0.82)
  );
  color: #fff;
  border: none;
  font-size: 0.86rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: none;
  text-decoration: none;
}

.profile-login-btn,
.profile-logout-btn {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.14);
}

.edit-profile-btn:hover,
.profile-login-btn:hover,
.profile-logout-btn:hover {
  transform: none;
  box-shadow: none;
}

.profile-logout-btn:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.edit-actions {
  display: flex;
  gap: 10px;
}

.save-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background-color: #28a745;
  color: #fff;
  border: none;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.save-btn:hover {
  background-color: #218838;
  transform: translateY(-2px);
}

.cancel-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background-color: #6c757d;
  color: #fff;
  border: none;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.cancel-btn:hover {
  background-color: #5a6268;
  transform: translateY(-2px);
}

/* 个人简介部分 */
.user-bio-section {
  margin-bottom: 9px;
}

.user-bio {
  color: rgba(245, 248, 246, 0.88);
  line-height: 1.5;
  font-size: 0.83rem;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.user-bio p {
  margin: 0;
}

/* 用户详情部分 */
.user-details-section {
  margin-bottom: 0;
}

.user-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-detail {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(245, 248, 246, 0.78);
  justify-content: flex-start;
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}

.user-detail i {
  color: var(--primary-color);
  font-size: 1.1rem;
}

.user-detail a {
  color: var(--primary-color);
  text-decoration: none;
  transition: all 0.2s ease;
}

.user-detail a:hover {
  text-decoration: underline;
}

.social-links {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
}

.social-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background-color: rgba(255, 255, 255, 0.06);
  color: var(--primary-color);
  transition: all 0.3s ease;
}

.social-link:hover {
  background-color: var(--primary-color);
  color: #fff;
  transform: none;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.social-edit {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.profile-edit-form .form-group {
  margin-bottom: 14px;
}

.profile-edit-form .form-row .form-group {
  margin-bottom: 0;
}

.profile-edit-modal {
  --pe-accent: #6a4fe0;
  --pe-accent-bright: #8568f7;
  --pe-line: rgba(21, 26, 45, 0.12);
  --pe-muted: #79809a;
  --pe-heading: #151a2d;
  --pe-text: #3a4258;
  --pe-card: #ffffff;
  --pe-soft: rgba(106, 79, 224, 0.08);
  --pe-stamp: 4px 4px 0 rgba(106, 79, 224, 0.18);
  --pe-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  position: fixed;
  inset: 0;
  z-index: 4200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
  background: rgba(21, 26, 45, 0.48);
  backdrop-filter: blur(8px);
}

.profile-edit-dialog {
  position: relative;
  width: min(640px, 100%);
  max-height: min(820px, calc(100dvh - 32px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(106, 79, 224, 0.28);
  border-radius: 0;
  background:
    linear-gradient(135deg, rgba(106, 79, 224, 0.08), transparent 42%),
    var(--pe-card);
  color: var(--pe-text);
  box-shadow: var(--pe-stamp), 0 24px 72px rgba(58, 51, 112, 0.16);
}

html.color-scheme-dark .profile-edit-modal {
  --pe-accent: #a08bff;
  --pe-accent-bright: #c4b5fd;
  --pe-line: rgba(255, 255, 255, 0.12);
  --pe-muted: rgba(210, 205, 240, 0.68);
  --pe-heading: #f4f2ff;
  --pe-text: rgba(244, 242, 255, 0.88);
  --pe-card: #151826;
  --pe-soft: rgba(160, 139, 255, 0.1);
  --pe-stamp: 4px 4px 0 rgba(160, 139, 255, 0.22);
}

.profile-edit-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--pe-line);
  background: rgba(255, 255, 255, 0.02);
}

.profile-edit-header__copy {
  min-width: 0;
}

.profile-edit-kicker {
  display: inline-block;
  margin-bottom: 6px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--pe-accent);
  font-family: var(--pe-mono);
}

.profile-edit-header h3 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 760;
  color: var(--pe-heading);
}

.profile-edit-header p {
  margin: 6px 0 0;
  font-size: 0.84rem;
  line-height: 1.45;
  color: var(--pe-muted);
}

.modal-close-btn {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--pe-line);
  border-radius: 0;
  background: var(--pe-soft);
  color: var(--pe-heading);
  cursor: pointer;
}

.modal-close-btn:hover:not(:disabled) {
  border-color: var(--pe-accent);
  background: rgba(106, 79, 224, 0.12);
  color: var(--pe-accent);
}

.modal-close-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.profile-edit-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
}

.profile-edit-hero {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas:
    'avatar meta'
    'avatar action'
    'picker picker';
  gap: 10px 14px;
  padding: 14px;
  border: 1px solid var(--pe-line);
  border-radius: 0;
  background: var(--pe-soft);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.12);
}

.profile-edit-hero__avatar {
  grid-area: avatar;
  width: 72px;
  height: 72px;
  padding: 0;
  border: 1px solid var(--pe-line);
  border-radius: 0;
  background: var(--pe-card);
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.18);
}

.profile-edit-hero__avatar img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  border-radius: 0;
  border: none;
}

.profile-edit-hero__meta {
  grid-area: meta;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  min-width: 0;
}

.profile-edit-hero__meta strong {
  font-size: 1rem;
  font-weight: 720;
  color: var(--pe-heading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-edit-hero__meta span {
  font-size: 0.78rem;
  color: var(--pe-muted);
}

.profile-edit-hero__action {
  grid-area: action;
  align-self: start;
  width: fit-content;
  min-height: 34px;
  padding: 7px 12px;
  border: 1px solid var(--pe-accent);
  border-radius: 0;
  background: var(--pe-card);
  color: var(--pe-accent);
  font-size: 0.82rem;
  box-shadow: 2px 2px 0 rgba(106, 79, 224, 0.18);
}

.profile-edit-hero__action:hover {
  background: var(--pe-soft);
  transform: none;
}

.profile-edit-section {
  padding: 14px;
  border: 1px solid var(--pe-line);
  border-radius: 0;
  background: var(--pe-card);
}

.profile-edit-section__title {
  margin: 0 0 12px;
  font-size: 0.82rem;
  font-weight: 720;
  letter-spacing: 0.04em;
  color: var(--pe-heading);
}

.profile-edit-section .form-group:last-child,
.profile-edit-section .form-row:last-child {
  margin-bottom: 0;
}

.profile-edit-dialog .form-control {
  border: 1px solid var(--pe-line) !important;
}

.profile-edit-dialog .input-group-text {
  border: 1px solid var(--pe-line);
  border-right: none;
}

.profile-edit-dialog .input-group .form-control {
  border-left: none !important;
}

.modal-avatar-selector {
  grid-area: picker;
  position: static;
  width: 100%;
  margin-top: 4px;
  transform: none;
  box-shadow: none;
  border: 1px solid var(--pe-line);
  border-radius: 0;
  background: var(--pe-card);
}

.modal-avatar-selector .selector-header h6 {
  color: var(--pe-heading);
}

.modal-avatar-selector .close-btn {
  border-radius: 0;
  color: var(--pe-muted);
}

.modal-avatar-selector .close-btn:hover {
  background-color: var(--pe-soft);
  color: var(--pe-accent);
}

.modal-avatar-selector .default-avatars {
  grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
  gap: 10px;
  padding: 8px 12px 12px;
}

.modal-avatar-selector .avatar-option {
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--pe-line);
  border-radius: 0;
  background: transparent;
  cursor: pointer;
  overflow: hidden;
}

.modal-avatar-selector .avatar-option.is-active {
  border-color: var(--pe-accent);
  box-shadow: 2px 2px 0 rgba(106, 79, 224, 0.22);
}

.modal-avatar-selector .custom-avatar-input {
  padding: 0 12px 12px;
}

.modal-avatar-selector .custom-avatar-input .form-label {
  margin-bottom: 8px;
  font-size: 0.78rem;
  color: var(--pe-muted);
}

.public-profile-toggle {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  margin-bottom: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  cursor: pointer;
}

.public-profile-toggle input {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  accent-color: var(--pe-accent);
}

.public-profile-toggle span {
  min-width: 0;
}

.public-profile-toggle strong,
.public-profile-toggle small {
  display: block;
}

.public-profile-toggle strong {
  color: var(--pe-heading);
  font-size: 0.92rem;
}

.public-profile-toggle small {
  margin-top: 4px;
  color: var(--pe-muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

.profile-edit-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px max(16px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--pe-line);
  background: var(--pe-soft);
}

.profile-edit-footer .save-btn,
.profile-edit-footer .cancel-btn {
  min-width: 108px;
  justify-content: center;
  min-height: 40px;
  font-size: 0.9rem;
  border-radius: 0;
}

.profile-edit-footer .cancel-btn {
  border: 1px solid var(--pe-line);
  background: var(--pe-card);
  color: var(--pe-text);
}

.profile-edit-footer .cancel-btn:hover:not(:disabled) {
  background: var(--pe-soft);
  transform: none;
}

.profile-edit-footer .save-btn {
  border: 1px solid var(--pe-accent);
  background: var(--pe-accent);
  color: #ffffff;
  font-weight: 720;
  box-shadow: 3px 3px 0 rgba(106, 79, 224, 0.24);
}

.profile-edit-footer .save-btn:hover:not(:disabled) {
  filter: brightness(1.04);
  transform: none;
}

.profile-edit-footer .save-btn:disabled,
.profile-edit-footer .cancel-btn:disabled {
  opacity: 0.62;
  cursor: not-allowed;
}

.profile-edit-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.28);
  border-top-color: #ffffff;
  border-radius: 0;
  animation: profile-edit-spin 0.7s linear infinite;
}

@keyframes profile-edit-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 统计信息部分 */
.user-stats-section {
  display: none;
}

.stats-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 15px;
}

.stat-item {
  position: relative;
  text-align: center;
  background-color: rgba(var(--primary-color-rgb), 0.05);
  padding: 20px 15px;
  border-radius: 12px;
  transition: all 0.4s ease;
  overflow: hidden;
}

.stat-item:hover {
  transform: translateY(-5px);
  background-color: rgba(var(--primary-color-rgb), 0.1);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
}

.stat-value {
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--primary-color);
  margin-bottom: 5px;
  position: relative;
  z-index: 2;
}

.stat-label {
  font-size: 0.9rem;
  color: var(--text-color);
  font-weight: 500;
  position: relative;
  z-index: 2;
}

.stat-icon {
  position: absolute;
  bottom: -10px;
  right: -10px;
  font-size: 3rem;
  color: rgba(var(--primary-color-rgb), 0.1);
  z-index: 1;
  transition: all 0.4s ease;
}

.stat-item:hover .stat-icon {
  transform: scale(1.2) rotate(10deg);
  color: rgba(var(--primary-color-rgb), 0.15);
}

/* 动画 */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translate(-50%, 10px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

/* 响应式调整 */
@media (max-width: 768px) {
  .profile-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .user-header {
    flex-direction: column;
    align-items: center;
  }

  .user-info-section {
    text-align: center;
  }

  .user-name {
    text-align: center;
  }

  .user-details {
    align-items: center;
  }

  .social-links {
    justify-content: center;
  }

  .stats-container {
    grid-template-columns: repeat(2, 1fr);
  }

  .profile-edit-modal {
    align-items: flex-end;
    padding: 0;
  }

  .profile-edit-dialog {
    width: 100%;
    max-height: min(92dvh, calc(100dvh - env(safe-area-inset-top)));
    border-radius: 0;
    border-bottom: none;
  }

  .profile-edit-body {
    gap: 12px;
    padding: 14px 16px;
  }

  .profile-edit-header {
    padding: 16px 16px 12px;
  }

  .profile-edit-hero {
    grid-template-columns: 1fr;
    grid-template-areas:
      'avatar'
      'meta'
      'action'
      'picker';
    justify-items: center;
    text-align: center;
  }

  .profile-edit-hero__meta {
    align-items: center;
  }

  .form-row,
  .social-edit {
    grid-template-columns: 1fr;
  }

  .profile-edit-footer {
    padding: 12px 16px max(16px, env(safe-area-inset-bottom));
  }

  .profile-edit-footer .save-btn,
  .profile-edit-footer .cancel-btn {
    flex: 1 1 0;
    min-width: 0;
  }
}

/* 主题特定样式 */
:root.cyberpunk-theme .avatar-frame {
  background: linear-gradient(145deg, var(--cyberpunk-primary), var(--cyberpunk-secondary));
  box-shadow: 0 0 20px var(--cyberpunk-primary);
}

:root.matrix-theme .avatar-frame {
  background: linear-gradient(145deg, var(--matrix-primary), transparent);
  box-shadow: 0 0 15px var(--matrix-primary);
}

:root.matrix-theme .profile-card {
  border: none;
}

:root.retrowave-theme .avatar-frame {
  background: linear-gradient(145deg, var(--retrowave-primary), var(--retrowave-secondary));
}

:root.minimal-theme .profile-card {
  box-shadow: none;
  background-color: transparent;
}

:root.minimal-theme .profile-card-decoration {
  display: none;
}

:root.minimal-theme .avatar-frame {
  background: none;
  box-shadow: none;
}

:root.minimal-theme .stat-item {
  background-color: transparent;
}

:root.minimal-theme .edit-profile-btn,
:root.minimal-theme .save-btn,
:root.minimal-theme .cancel-btn {
  border-radius: 4px;
}
</style>
