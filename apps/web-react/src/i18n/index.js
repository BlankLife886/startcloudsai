export { ClientLocaleBridge } from "./ClientLocaleBridge.jsx";
export { LocaleProvider, useLocale } from "./LocaleProvider.jsx";
export {
  LOCALE_OPTIONS,
  LOCALE_STORAGE_KEY,
  applyLocaleToDocument,
  normalizeLocale,
  persistLocale,
  readLocale,
} from "./locale.js";
export {
  CLIENT_TRANSLATION_DICTIONARIES as dictionaries,
  translateClientAttribute,
  translateClientDictionary,
  translateClientText,
} from "@react/legacy-modules/i18n/clientTranslations.js";
