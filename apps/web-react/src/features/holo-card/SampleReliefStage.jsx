import { useEffect, useImperativeHandle, useRef } from 'react';
import { createSampleReliefRenderer } from './sample-relief-renderer.js';
import { useCardMotion } from './useCardMotion.js';

export function SampleReliefStage({ assets = {}, settings = {}, stageRef, onReady, onError }) {
  const containerRef = useRef(null);
  const { engineRef, controlsRef, state } = useCardMotion({
    containerRef, createRenderer: createSampleReliefRenderer, settings,
    hasArtwork: Boolean(assets.subject && assets.background), onReady, onError,
    initialPose: { x: -.3, y: .045 },
    initializationError: '当前浏览器无法启动 3D 样卡，请开启硬件加速后重试。',
  });

  useEffect(() => {
    void engineRef.current?.setImages(assets);
  }, [assets.subject, assets.background, assets.effects, assets.lineart]);

  useImperativeHandle(stageRef, () => ({
    async exportPng() {
      if (!engineRef.current) throw new Error('样卡尚未就绪。');
      return engineRef.current.exportPng();
    },
    async exportTextPng() {
      if (!engineRef.current) throw new Error('样卡尚未就绪。');
      return engineRef.current.exportTextPng();
    },
    getState() { return controlsRef.current?.getState(); },
    reset() { controlsRef.current?.reset(); },
    shine() { return controlsRef.current?.shine() ?? false; },
  }), []);

  return (
    <div
      ref={containerRef}
      className="sample-relief-stage"
      data-sample-state={state}
      data-sample-face={settings.flipped ? 'back' : 'front'}
      tabIndex={0}
      role="group"
      aria-label="立体镭射样卡，移动鼠标或拖动查看，双击追光，方向键旋转，Home 键归正"
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 280, touchAction: 'pan-y' }}
    />
  );
}
