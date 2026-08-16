import { useEffect, useRef, useState } from "react";
import { DialogMotion } from "../../components/motion/DialogMotion.jsx";
import "./HandheldGuideDialog.css";

const SECTIONS = [
  { id: "intro", label: "能做什么" },
  { id: "steps", label: "最快四步" },
  { id: "product", label: "商品图" },
  { id: "packs", label: "出图任务" },
  { id: "header", label: "顶栏设置" },
  { id: "crop", label: "出镜与手" },
  { id: "scene", label: "姿势与场景" },
  { id: "result", label: "生成与管理" },
  { id: "tips", label: "常见问题" },
];

export function HandheldGuideDialog({ open, onClose }) {
  const [active, setActive] = useState("intro");
  const bodyRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setActive("intro");
    bodyRef.current?.scrollTo({ top: 0 });
  }, [open]);

  function scrollTo(id) {
    const target = bodyRef.current?.querySelector(`#handheld-guide-${id}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  }

  return (
    <DialogMotion
      open={open}
      variant="detail"
      layerClassName="handheld-guide-layer"
      panelClassName="handheld-guide-panel"
      ariaLabel="手持商品操作说明"
      onClose={onClose}
    >
      <header className="handheld-guide__head" data-dialog-motion-item>
        <div>
          <em>手持商品图</em>
          <h2>操作说明</h2>
        </div>
        <p>
          把白底商品放进一只真实的手里，带上场景和光线，直接出可上架的主图、详情和社媒图。
        </p>
        <button
          type="button"
          className="handheld-guide__close"
          aria-label="关闭操作说明"
          onClick={onClose}
        >
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>
      </header>

      <div className="handheld-guide__layout" data-dialog-motion-item>
        <nav className="handheld-guide__nav" aria-label="操作说明目录">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={active === item.id ? "is-active" : ""}
              aria-current={active === item.id ? "true" : undefined}
              onClick={() => scrollTo(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <article
          ref={bodyRef}
          className="handheld-guide__body"
          aria-label="手持商品使用步骤"
        >
          <section id="handheld-guide-intro">
            <h3>能做什么</h3>
            <p>
              工具只做一件事：用你上传的商品图，生成「真人手持这件货」的商业摄影。商品外观、包装、Logo、文字、颜色和真实尺寸会尽量锁住；手、握持、接触阴影和场景由模型补全。
            </p>
            <ul>
              <li>默认出<strong>不出脸</strong>的手腕特写，适合电商主图。</li>
              <li>需要半身或全身时，再选模特模板，锁定同一人。</li>
              <li>场景图只借环境和光线，不会把场景里的人或原商品带进结果。</li>
              <li>这不是试衣。不要上传服装全身图，也不要用自拍当商品图。</li>
            </ul>
          </section>

          <section id="handheld-guide-steps">
            <h3>最快四步</h3>
            <ol className="handheld-guide__steps">
              <li>
                <div>
                  <strong>上传商品图</strong>
                  <span>白底或简单背景，产品完整，Logo 可读。可拖拽到左侧商品区。</span>
                </div>
              </li>
              <li>
                <div>
                  <strong>选出图任务</strong>
                  <span>第一次用选「单张主图」。要详情页再换成「详情套图」。</span>
                </div>
              </li>
              <li>
                <div>
                  <strong>选投放渠道</strong>
                  <span>画布左上角决定去淘宝、小红书还是抖音，画面比例会跟着变。</span>
                </div>
              </li>
              <li>
                <div>
                  <strong>点生成</strong>
                  <span>生成时主图会显示加载状态。成图后可重生、局部重绘或存入素材库。</span>
                </div>
              </li>
            </ol>
          </section>

          <section id="handheld-guide-product">
            <h3>商品图怎么传</h3>
            <p>商品图是身份锁，质量直接决定成图能不能上架。</p>
            <ul>
              <li>优先白底、去背景或浅色干净背景，商品完整入画。</li>
              <li>正面品牌面清楚，Logo 和包装文字不要糊、不要被裁切。</li>
              <li>建议 PNG。同一件货不要用已经有人手持的实拍当商品图。</li>
              <li>品类选对（瓶装、数码、口红等），握持会更合理。</li>
              <li>包装状态选「出手货 / 盒装 / 套装」，避免只出空盒或只出裸货。</li>
              <li>顶栏「商品信息」可选填商品名、货号、必须露出 Logo 等硬要求。</li>
            </ul>
          </section>

          <section id="handheld-guide-packs">
            <h3>出图任务怎么选</h3>
            <p>投放渠道和出图任务都在画布左上角。先选渠道（比例跟着变），再想清楚这次要交哪几张。套图会尽量保持同一只手、同一件货、同一套光。</p>
            <dl>
              <div>
                <dt>投放渠道</dt>
                <dd>
                  淘宝/天猫主图是 1:1，详情页和小红书是 3:4，抖音是 9:16，独立站是
                  4:5。比例由渠道决定，不再单独选比例。
                </dd>
              </div>
              <div>
                <dt>单张主图 · 1 张</dt>
                <dd>上架主图位。默认手腕特写、自然握持。</dd>
              </div>
              <div>
                <dt>详情套图 · 4 张</dt>
                <dd>主图、递出展示、使用瞬间、材质特写，适合详情页 / A+。</dd>
              </div>
              <div>
                <dt>社媒投放包 · 3 张</dt>
                <dd>封面、种草近景、竖屏投放，适合小红书和信息流。</dd>
              </div>
              <div>
                <dt>开箱套图 · 3 张</dt>
                <dd>开箱取出、出手货、细节特写。包装和商品都要准。</dd>
              </div>
              <div>
                <dt>主图对比 · 2 张</dt>
                <dd>自然握持 + 递出展示，方便挑一张上架。</dd>
              </div>
            </dl>
          </section>

          <section id="handheld-guide-header">
            <h3>顶栏设置</h3>
            <dl>
              <div>
                <dt>生成模型</dt>
                <dd>决定画质和速度。不确定就用当前默认模型。</dd>
              </div>
              <div>
                <dt>画面方案</dt>
                <dd>
                  先点四张预设：商品主图、生活种草、功能展示、材质特写。需要再改风格、焦段、机位、景深、光影、焦点和生成方式。
                </dd>
              </div>
              <div>
                <dt>商品信息 / 握持姿势</dt>
                <dd>可选填品类、货号、必须露出的 Logo，以及手怎么握这件货。</dd>
              </div>
            </dl>
            <p>
              生成方式一般保持「自动」。Logo
              容易糊时改「商品像素保真」。上传构图参考后会自动按「真图换货」复刻。
            </p>
          </section>

          <section id="handheld-guide-crop">
            <h3>出镜范围、手指图、模特</h3>
            <p>主图默认不出脸。出不出脸，决定你要不要上传手或模特。</p>
            <ul>
              <li>
                <strong>手指特写 / 手腕特写</strong>
                ：只出手和商品，不需要模特。可选手指图，不要用人像或半身照代替。
              </li>
              <li>
                <strong>半身禁脸 / 半身出镜 / 全身出镜</strong>
                ：必须选模特模板或上传同一人。半身禁脸仍用模特图，只是成片裁掉或转开脸。
              </li>
              <li>
                手指图只看手、腕、肤色和指甲，不要传带脸的自拍。
              </li>
              <li>没有合适的手部模板时，可以不选，直接生成。</li>
            </ul>
          </section>

          <section id="handheld-guide-scene">
            <h3>握持姿势和场景</h3>
            <ul>
              <li>
                姿势按品类选：瓶装常用自然握持或开盖，口红用两指捏，喷雾用喷，耳机用佩戴瞬间。
              </li>
              <li>左右手按包装朝向选，盒面文字要顺着读。</li>
              <li>
                场景只提供环境和光线。选模板或自己上传现场图都可以，结果里不会出现场景原图里的人。
              </li>
              <li>生活种草预设会偏向环境中景和现场光，主图预设更干净、主体更大。</li>
              <li>
                要借竞品构图，直接上传构图参考即可，单张或套图都能用。只借构图和光线，换成自己的货，不复制原品牌。
              </li>
            </ul>
          </section>

          <section id="handheld-guide-result">
            <h3>生成之后怎么处理</h3>
            <ul>
              <li>点主图画布中的「生成」。套图会按任务一次出多张，费用按张数计。</li>
              <li>成图点开可看大图。主图底部可修改说明、重生、局部重绘或存入素材库。</li>
              <li>
                <strong>重生</strong>用同一组设置再出一张。
              </li>
              <li>
                <strong>局部重绘</strong>只改手指、阴影或背景一小块，不要整张重画。
              </li>
              <li>右侧「历史」是本轮缩略图，点一下就能切回上一张。</li>
              <li>要留作以后用，点「存入素材库」。电商历史里也能找回。</li>
            </ul>
          </section>

          <section id="handheld-guide-tips">
            <h3>常见问题</h3>
            <dl>
              <div>
                <dt>商品变形、Logo 乱码</dt>
                <dd>
                  换更清楚的白底图；画面方案里把生成方式改成「商品像素保真」；卖点里写「必须露出
                  Logo」。
                </dd>
              </div>
              <div>
                <dt>手指数量不对、穿模</dt>
                <dd>点重生。仍不行就换「手腕特写」，或上传一张真实手部特写。</dd>
              </div>
              <div>
                <dt>尺度不像真人手掌</dt>
                <dd>
                  核对品类。安瓶、口红用三指捏或两指捏；大瓶、礼盒用双手托举。
                </dd>
              </div>
              <div>
                <dt>出了脸，或换了一个人</dt>
                <dd>
                  主图请改回手腕特写。要出镜必须选模特模板，不要把手指图换成半身人像。
                </dd>
              </div>
              <div>
                <dt>场景里出现了参考图的人或货</dt>
                <dd>换一张没有人物、没有竞品的环境图，或改用模板场景。</dd>
              </div>
              <div>
                <dt>套图里手或货对不上</dt>
                <dd>
                  先出单张确认商品图没问题，再出套图。套图不要中途换商品图、手或场景。
                </dd>
              </div>
            </dl>
          </section>
        </article>
      </div>
    </DialogMotion>
  );
}
