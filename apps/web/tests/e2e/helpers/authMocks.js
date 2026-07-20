export function fulfillJson(route, data, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ success: status >= 200 && status < 300, data }),
  })
}

export async function mockBootstrapConfig(page) {
  await page.route('**/api/client/bootstrap/config**', async (route) => {
    await fulfillJson(route, {
      config: {
        version: 'e2e-bootstrap',
        endpoints: { apiBaseUrl: '/api', openAiBaseUrl: '/v1' },
        routes: {
          '/': { enabled: true },
          '/search': { enabled: true },
          '/settings': { enabled: true },
          '/profile': { enabled: true },
          '/auth/login': { enabled: true },
          '/auth/register': { enabled: true },
          '/access-limited': { enabled: true },
        },
        features: {
          download: { enabled: true },
          favorite: { enabled: true },
          history: { enabled: true },
          sync: { enabled: true },
          userActionLog: { enabled: true },
        },
        pageLayout: {},
        limits: {},
        aiModelCatalog: { providers: [], models: [], publicModels: [], featurePublicModels: [], updatedAt: '' },
        userOverrides: {},
        blacklist: { blocked: false, reason: '', scope: {}, endsAt: '' },
      },
    })
  })
}

export async function mockAuthConfig(page) {
  await page.route('**/api/client/auth/config', async (route) => {
    await fulfillJson(route, {
      config: {
        turnstileSiteKey: '',
        turnstileEnabled: false,
        requireEmailVerification: false,
        oauthProviders: [],
      },
    })
  })
}
