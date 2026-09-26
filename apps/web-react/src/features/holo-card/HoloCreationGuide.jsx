import { useRef } from 'react';
import { Check, Download, ImagePlus, Layers, Sparkles, X } from 'lucide-react';
import { DialogMotion } from '../../components/motion/DialogMotion.jsx';
import './holo-creation-guide.css';

export function HoloCreationGuide({ hasImage, hasSubject, layered, pending, assembled, previewFailed, ready, disabled, generateDisabled, busyLabel, onChoose, onEffects, onGenerate, onInspect, onExport }) {
  return <aside className={`holo-creation-guide holo-enter${layered && assembled && !previewFailed ? ' is-complete' : ''}`} aria-label="制卡步骤" data-holo-preserve-pose>
    <ol className="holo-creation-steps"><li className={hasImage ? 'is-done' : 'is-current'}>{hasImage ? <Check size={11}/> : <span>1</span>}选人物</li><li className={hasSubject ? 'is-done' : hasImage ? 'is-current' : ''}>{hasSubject ? <Check size={11}/> : <span>2</span>}准备主体</li><li className={hasSubject ? 'is-current' : ''}><span>3</span>同款完成</li></ol>
    <span className="holo-creation-kicker">{!hasImage ? '星间旅人 · 示例同款' : pending ? '主体已生成，等待你确认' : layered ? assembled ? '已使用示例的完整四层版式' : '正在载入四层素材' : '背景、光屑与排版已配好'}</span>
    <h2>{!hasImage ? '换上你的人物，制作同款' : pending ? '确认主体，就能完成同款' : layered ? previewFailed ? '卡片预览暂不可用' : assembled ? '你的同款闪卡已完成' : '正在装配四层同款' : hasSubject ? '正在查看原图对照' : '再分离主体，就有示例层次'}</h2>
    <p>{!hasImage ? '星轨背景、前景光屑、文字与烫金都已准备好。只需换上你的图片。' : pending ? '放大检查人物轮廓，点击“采用此图层”，会自动组成完整的四层卡片。' : layered ? previewFailed ? '透明人物已保留，请根据画布上的提示恢复预览。' : '人物、背景、光屑和文字自动分层。画面就绪后，可以转动查看并保存。' : hasSubject ? '透明主体和整套版式都已保留，点击“返回同款效果”即可继续，不需要再次生成。' : '点击“生成同款”，让 image2 移除人物背景；确认主体后，四层效果会自动完成。'}</p>
    <div className="holo-creation-actions">
      {!hasImage ? <button type="button" className="holo-primary" onClick={onChoose} disabled={disabled}><ImagePlus size={15}/>制作同款</button>
        : pending ? <button type="button" className="holo-primary" onClick={onInspect}><Layers size={15}/>检查透明主体</button>
          : layered ? <button type="button" className="holo-primary" onClick={onExport} disabled={!ready}><Download size={15}/>保存同款闪卡</button>
            : <button type="button" className="holo-primary" onClick={onGenerate} disabled={disabled || generateDisabled}><Sparkles size={15}/>{busyLabel || (hasSubject ? '返回同款效果' : '生成同款')}</button>}
      {hasImage && !pending && <button type="button" className="holo-creation-secondary" onClick={layered ? onEffects : onExport} disabled={!ready}>{layered ? <Sparkles size={14}/> : <Download size={14}/>} {layered ? '调整光泽' : '保存当前预览'}</button>}
    </div>
    {!hasImage && <small className="holo-creation-fast-note">已有透明 PNG？选中后会直接完成同款，无需生成。</small>}
  </aside>;
}

export function HoloHowToDialog({ open, onClose, onChoose }) {
  const closeRef = useRef(null);
  const keepFocus = event => {
    if (event.key !== 'Tab') return;
    const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
    if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
  };
  return <DialogMotion open={open} onClose={onClose} initialFocusRef={closeRef} layerClassName="holo-help-layer" panelClassName="holo-help-panel" ariaLabelledby="holo-help-title">
    <div onKeyDown={keepFocus}>
      <header><span>从图片到闪卡</span><button ref={closeRef} type="button" aria-label="关闭使用说明" onClick={onClose}><X size={18}/></button></header>
      <h2 id="holo-help-title">把示例换成你的人物</h2>
      <p className="holo-help-intro">整套版式已经配好，不用自己准备背景、光屑或调图层深度。</p>
      <ol className="holo-help-steps">
        <li><span>01</span><div><strong>点击“制作同款”，选择人物图片</strong><p>透明 PNG 通过检查后会直接套入四层模板。普通照片会先显示整张图片的版式预览。</p></div></li>
        <li><span>02</span><div><strong>普通照片再点“生成同款”</strong><p>确认积分后，image2 会准备透明主体。放大检查轮廓，点击“采用此图层”，背景、光屑、文字与立体层次就会自动配齐。</p></div></li>
        <li><span>03</span><div><strong>选皮肤，转动查看，再保存</strong><p>点击“皮肤”，挑一套动漫、像素、精灵、田园或决斗风格，整张卡自动换装。满意后点击“保存同款闪卡”或右上角“导出图片”。PNG 保存当前画面，鼠标互动在页面里体验。</p></div></li>
      </ol>
      <div className="holo-help-depth"><Layers size={19}/><div><strong>皮肤换整套，角色始终是你的</strong><p>背景、人物、前景装饰、卡框和文字分别放置，透明人物能与背景产生前后层次。皮肤面板中还能混搭部件、改文字，或上传自己的卡框和卡背。</p><p>若调乱了，再点一次喜欢的皮肤即可恢复整套搭配。你的角色和已填写的文字会保留。</p></div></div>
      <footer><button type="button" onClick={onClose}>明白了</button><button type="button" className="holo-help-start" onClick={() => { onClose(); onChoose(); }}><ImagePlus size={16}/>选择图片开始</button></footer>
    </div>
  </DialogMotion>;
}
