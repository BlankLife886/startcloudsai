import { useEffect, useLayoutEffect, useRef } from "react";
import {
  translateClientAttribute,
  translateClientText,
} from "@react/legacy-modules/i18n/clientTranslations.js";

const TRANSLATED_ATTRIBUTES = ["placeholder", "title", "aria-label"];
const SKIP_SELECTOR =
  'script,style,code,pre,textarea,[contenteditable="true"],[data-no-translate],.notranslate';
const ATTRIBUTE_SKIP_SELECTOR =
  'script,style,code,pre,[contenteditable="true"],[data-no-translate],.notranslate';

function shouldSkip(element, attributes = false) {
  return !element || Boolean(element.closest(attributes ? ATTRIBUTE_SKIP_SELECTOR : SKIP_SELECTOR));
}

export function ClientLocaleBridge({ locale }) {
  const localeRef = useRef(locale);
  const textSourcesRef = useRef(new WeakMap());
  const textOutputsRef = useRef(new WeakMap());
  const attributeSourcesRef = useRef(new WeakMap());
  const attributeOutputsRef = useRef(new WeakMap());
  const titleRef = useRef({ source: "", output: "" });
  localeRef.current = locale;

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || shouldSkip(parent)) return;
    const current = String(node.nodeValue || "");
    if (!current.trim()) return;

    const sources = textSourcesRef.current;
    const outputs = textOutputsRef.current;
    if (!sources.has(node) || current !== outputs.get(node)) sources.set(node, current);
    const translated = translateClientText(sources.get(node) || current, localeRef.current);
    outputs.set(node, translated);
    if (translated !== current) node.nodeValue = translated;
  }

  function translateAttributes(element) {
    if (shouldSkip(element, true)) return;
    const sourceCache = attributeSourcesRef.current;
    const outputCache = attributeOutputsRef.current;
    let sources = sourceCache.get(element);
    let outputs = outputCache.get(element);
    if (!sources) {
      sources = new Map();
      outputs = new Map();
      sourceCache.set(element, sources);
      outputCache.set(element, outputs);
    }

    for (const name of TRANSLATED_ATTRIBUTES) {
      if (!element.hasAttribute(name)) continue;
      const current = element.getAttribute(name) || "";
      if (!sources.has(name) || current !== outputs.get(name)) sources.set(name, current);
      const translated = translateClientAttribute(sources.get(name), localeRef.current);
      outputs.set(name, translated);
      if (translated !== current) element.setAttribute(name, translated);
    }
  }

  function translateTree(root = document.body) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;

    translateAttributes(root);
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateAttributes(node);
      node = walker.nextNode();
    }
  }

  function translateDocumentTitle() {
    const current = document.title;
    const title = titleRef.current;
    if (!title.source || current !== title.output) title.source = current;
    const translated = translateClientText(title.source, localeRef.current);
    title.output = translated;
    if (translated !== current) document.title = translated;
  }

  useLayoutEffect(() => {
    translateTree(document.body);
    translateDocumentTitle();
  }, [locale]);

  useEffect(() => {
    let scheduled = false;
    const scheduleTranslation = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        translateTree(document.body);
        translateDocumentTitle();
      });
    };
    const observer = new MutationObserver(scheduleTranslation);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATED_ATTRIBUTES,
    });
    return () => observer.disconnect();
  }, []);

  return null;
}

