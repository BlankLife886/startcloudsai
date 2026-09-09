import { createContext, useContext, useMemo, useState } from "react";
import { translateClientText } from "@react/legacy-modules/i18n/clientTranslations.js";
import { ClientLocaleBridge } from "./ClientLocaleBridge.jsx";
import {
  LOCALE_OPTIONS,
  applyLocaleToDocument,
  normalizeLocale,
  persistLocale,
  readLocale,
} from "./locale.js";

const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(() => applyLocaleToDocument(readLocale()));

  const value = useMemo(() => {
    const setLocale = (nextValue) => {
      const nextLocale = applyLocaleToDocument(persistLocale(nextValue));
      setLocaleState(nextLocale);
    };
    return {
      locale,
      option: LOCALE_OPTIONS.find((item) => item.value === locale) || LOCALE_OPTIONS[0],
      options: LOCALE_OPTIONS,
      setLocale,
      t: (source) => translateClientText(source, locale),
      normalizeLocale,
    };
  }, [locale]);

  return (
    <LocaleContext.Provider value={value}>
      {children}
      <ClientLocaleBridge locale={locale} />
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider");
  return context;
}

