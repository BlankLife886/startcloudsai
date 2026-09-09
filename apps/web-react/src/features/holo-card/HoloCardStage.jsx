import { useEffect, useImperativeHandle, useRef } from 'react';
import { createHoloCardRenderer } from './holo-card-renderer.js';
import { useCardMotion } from './useCardMotion.js';

export function HoloCardStage({ sourceUrl, subjectUrl, backgroundUrl, lineartUrl, mode = 'original', settings = {}, stageRef, onError, onReady }) {
  const containerRef = useRef(null);
  const { engineRef, controlsRef, state } = useCardMotion({
    containerRef, createRenderer: createHoloCardRenderer, settings,
    hasArtwork: Boolean(sourceUrl || (mode === 'layered' && subjectUrl)), onReady, onError,
    initializationError: '当前浏览器无法启动 3D 预览，请开启硬件加速后重试。',
  });

  useEffect(() => {
    void engineRef.current?.setImages({ sourceUrl, subjectUrl, backgroundUrl, lineartUrl, mode });
  }, [sourceUrl, subjectUrl, backgroundUrl, lineartUrl, mode]);

  useImperativeHandle(stageRef, () => ({
    async exportPng() {
      if (!engineRef.current) throw new Error('3D 预览尚未就绪。');
      return engineRef.current.exportPng();
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
      data-holo-face={settings.flipped ? 'back' : 'front'}
      tabIndex={0}
      role="group"
      aria-label="立体镭射闪卡预览，移动鼠标或拖动查看，双击追光，方向键旋转，Home 键归正"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 280, touchAction: 'pan-y' }}
    />
  );
}
