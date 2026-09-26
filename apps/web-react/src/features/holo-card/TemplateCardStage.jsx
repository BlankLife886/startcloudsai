import { useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { ASTRAL_TEMPLATE_SETTINGS } from './holoTemplates.js';
import { cardDesignAssetKey, getCardDesignAssets } from './cardSkinAssets.js';
import { getCardSkin } from './cardSkins.js';
import { createSampleReliefRenderer } from './sample-relief-renderer.js';
import { useCardMotion } from './useCardMotion.js';

export function TemplateCardStage({ sourceUrl, subjectUrl, backgroundUrl, frameUrl, effectsUrl, backUrl, lineartUrl, mode = 'original', settings = {}, stageRef, onError, onReady }) {
  const containerRef = useRef(null);
  const assetsLoading = useRef(false), callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  const layered = mode === 'layered' && Boolean(subjectUrl);
  const artworkUrl = layered ? subjectUrl : sourceUrl;
  const templateLineart = layered ? lineartUrl : undefined;
  const designKey = cardDesignAssetKey(settings);
  const layoutId = settings.layoutDesign || 'skin';
  const renderSettings = useMemo(() => ({
    ...ASTRAL_TEMPLATE_SETTINGS, ...settings, subjectFraming: layered ? 'auto' : 'contain',
  }), [settings, layered]);
  const { engineRef, controlsRef, state } = useCardMotion({
    containerRef, createRenderer: createSampleReliefRenderer, settings: renderSettings,
    hasArtwork: Boolean(artworkUrl), onReady: ready => callbacks.current.onReady?.(ready && !assetsLoading.current), onError,
    initialPose: { x: -.3, y: .045 },
    initializationError: '当前浏览器无法启动 3D 预览，请开启硬件加速后重试。',
  });

  useEffect(() => {
    let current = true;
    const urls = [];
    assetsLoading.current = true;
    callbacks.current.onReady?.(false);
    void (async () => {
      try {
        const generated = await getCardDesignAssets(settings);
        if (!current) return;
        const assets = Object.fromEntries(Object.entries(generated).map(([part, value]) => {
          if (!(value instanceof Blob)) return [part, value];
          const url = URL.createObjectURL(value); urls.push(url); return [part, url];
        }));
        assetsLoading.current = false;
        await engineRef.current?.setImages({
          ...assets, subject: artworkUrl, lineart: templateLineart,
          background: backgroundUrl || assets.background,
          frame: frameUrl || assets.frame, effects: effectsUrl || assets.effects, back: backUrl || assets.back,
        });
      } catch (error) {
        if (current) { assetsLoading.current = false; callbacks.current.onError?.(error.message || '皮肤暂时无法载入，请重新选择。'); }
      }
    })();
    return () => { current = false; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [artworkUrl, backgroundUrl, frameUrl, effectsUrl, backUrl, templateLineart, layered, designKey, layoutId, settings.skinId]);

  useImperativeHandle(stageRef, () => ({
    async exportPng() {
      if (!engineRef.current || assetsLoading.current) throw new Error('卡片正在换装，请稍候再导出。');
      return engineRef.current.exportPng();
    },
    async exportTextPng() {
      if (!engineRef.current) throw new Error('3D 预览尚未就绪。');
      return engineRef.current.exportTextPng();
    },
    reset() { controlsRef.current?.reset(); },
    shine() { return controlsRef.current?.shine() ?? false; },
    getState() { return controlsRef.current?.getState(); },
  }), []);

  return (
    <div
      ref={containerRef}
      className="holo-card-stage"
      data-holo-state={state}
      data-holo-mode={mode}
      data-holo-face={renderSettings.flipped ? 'back' : 'front'}
      data-card-template={getCardSkin(settings.skinId).id}
      tabIndex={0}
      role="group"
      aria-label="立体镭射闪卡预览，移动鼠标或拖动查看，双击追光，方向键旋转，Home 键归正"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 280, touchAction: 'pan-y' }}
    />
  );
}
