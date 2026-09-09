import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";
import zhTW from "@/i18n/locales/zh-TW";

export type AppLocale = "zh-CN" | "zh-TW" | "en";

i18n.use(initReactI18next).init({
    resources: {
        "zh-CN": { translation: zhCN },
        "zh-TW": { translation: zhTW },
        en: { translation: enUS },
    },
    lng: "zh-CN",
    fallbackLng: "zh-CN",
    supportedLngs: ["zh-CN", "zh-TW", "en"],
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

export function changeAppLocale(locale: AppLocale) {
    return i18n.changeLanguage(locale);
}

export default i18n;
