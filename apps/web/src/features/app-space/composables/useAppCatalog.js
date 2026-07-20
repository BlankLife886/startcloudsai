import { computed } from 'vue'
import {
  APP_CATALOG,
  APP_SCOPE_EMPTY,
  APP_SCOPE_LABELS,
  APP_TYPE_LABELS,
} from '@/config/appCatalog'

const SCOPE_ORDER = ['site', 'other']

function resolveStatus(app) {
  if (app.status === 'draft' || app.status === 'published') return app.status
  return app.href ? 'published' : 'draft'
}

function enrichApp(app) {
  const status = resolveStatus(app)
  return {
    ...app,
    status,
    scopeLabel: APP_SCOPE_LABELS[app.scope] || app.scope,
    typeLabel: APP_TYPE_LABELS[app.type] || app.type,
    href: status === 'published' && app.href ? app.href : '',
  }
}

export function useAppCatalog() {
  const apps = computed(() =>
    APP_CATALOG.map(enrichApp).sort((a, b) => a.sort - b.sort),
  )

  const publishedApps = computed(() => apps.value.filter((app) => app.status === 'published'))
  const draftApps = computed(() => apps.value.filter((app) => app.status === 'draft'))

  function groupByScope(list) {
    return SCOPE_ORDER.map((scope) => ({
      scope,
      label: APP_SCOPE_LABELS[scope],
      emptyText: APP_SCOPE_EMPTY[scope],
      apps: list.filter((app) => app.scope === scope),
    }))
  }

  return {
    apps,
    publishedApps,
    draftApps,
    groupByScope,
  }
}
