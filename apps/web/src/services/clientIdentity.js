import storageService from './storage'

const CLIENT_ID_KEY = 'client_id'

export function getClientId() {
  let id = storageService.get(CLIENT_ID_KEY, '')
  if (!id) {
    id = `anon_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`
    storageService.set(CLIENT_ID_KEY, id)
  }
  return id
}
