import { Switch } from "antd-mobile";
import { AddOutline, CloseOutline, MinusOutline } from "antd-mobile-icons";
import { Sheet } from "./Sheet.jsx";
import { qualityLabel } from "./workGroups.js";

function Row({ title, children, rail = false }) {
  return (
    <div className="m-set-row">
      <span className="m-set-title">{title}</span>
      <div className={`m-set-options${rail ? " is-rail" : ""}`}>{children}</div>
    </div>
  );
}

function Chip({ selected, onClick, children }) {
  return (
    <button type="button" className={`m-set-chip m-pressable${selected ? " is-on" : ""}`} aria-pressed={selected} onClick={selected ? undefined : onClick}>
      {children}
    </button>
  );
}

function ToggleRow({ title, desc, checked, onChange }) {
  return (
    <label className="m-toggle-row">
      <span>
        <strong>{title}</strong>
        <small>{desc}</small>
      </span>
      <Switch checked={checked} onChange={onChange} />
    </label>
  );
}

/** 生成设置：与 App 的 _CreationSettingsPanel 一致，一屏放下模型、比例、清晰度、质量、数量；增强开关在最后。 */
export function ParamsSheet({ visible, onClose, form }) {
  const { settings, update, models, model, ratioOptions, resolutionOptions, qualityOptions, countOptions, capabilities, backgroundRemovalModel } = form;
  // 数量按模型允许的档位逐档加减（档位不一定连续）。
  const counts = [...new Set(countOptions.map(Number))].filter((value) => value > 0).sort((a, b) => a - b);
  const lower = counts.filter((value) => value < settings.count).pop();
  const higher = counts.find((value) => value > settings.count);
  return (
    <Sheet visible={visible} onClose={onClose} title="生成设置">
      <div className="m-settings">
        {models.length > 0 && (
          <Row title="模型" rail>
            {models.map((item) => (
              <Chip key={item.id} selected={item.id === model?.id} onClick={() => update({ modelId: item.id })}>{item.label}</Chip>
            ))}
          </Row>
        )}
        {ratioOptions.length > 0 && (
          <Row title="画面比例" rail>
            {ratioOptions.map((option) => (
              <Chip key={option.value} selected={settings.ratio === option.value} onClick={() => update({ ratio: option.value })}>{option.label}</Chip>
            ))}
          </Row>
        )}
        {resolutionOptions.length > 0 && (
          <Row title="清晰度">
            {resolutionOptions.map((option) => (
              <Chip key={option.value} selected={settings.resolution === option.value} onClick={() => update({ resolution: option.value })}>{option.label}</Chip>
            ))}
          </Row>
        )}
        {qualityOptions.length > 0 && (
          <Row title="质量">
            {qualityOptions.map((option) => (
              <Chip key={option.value} selected={settings.quality === option.value} onClick={() => update({ quality: option.value })}>{qualityLabel(option.value)}</Chip>
            ))}
          </Row>
        )}
        <Row title="生成数量">
          <span className="m-count">
            <button type="button" aria-label="减少" disabled={lower == null} onClick={() => update({ count: lower })}>
              <MinusOutline />
            </button>
            <strong>{settings.count} 张</strong>
            <button type="button" aria-label="增加" disabled={higher == null} onClick={() => update({ count: higher })}>
              <AddOutline />
            </button>
          </span>
        </Row>

        <h3 className="m-set-subtitle">增强</h3>
        <div className="m-toggle-list">
          <ToggleRow title="润色描述" desc="自动补全细节，让画面更完整" checked={settings.polish} onChange={(polish) => update({ polish })} />
          <ToggleRow title="翻译成英文" desc="部分模型对英文描述理解更准" checked={settings.translate} onChange={(translate) => update({ translate })} />
          {capabilities.transparentBackground && (
            <ToggleRow
              title="透明背景"
              desc="直接输出 PNG 透明底"
              checked={settings.transparent}
              onChange={(transparent) => update({ transparent, ...(transparent ? { autoRemove: false } : {}) })}
            />
          )}
          {backgroundRemovalModel && (
            <ToggleRow
              title="生成后抠图"
              desc={backgroundRemovalModel.pricePoints ? `每张另加 ${backgroundRemovalModel.pricePoints} 积分` : "自动去掉背景"}
              checked={settings.autoRemove}
              onChange={(autoRemove) => update({ autoRemove, ...(autoRemove ? { transparent: false } : {}) })}
            />
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** 参考图超过输入栏能放下的数量时，在这里查看全部、移除或继续添加。 */
export function ReferencesSheet({ visible, onClose, references, maxReferences, onAdd, onRemove }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={`参考图 ${references.length}/${maxReferences}`}>
      <div className="m-refs-grid">
        {references.map((item, index) => (
          <figure key={item.id} className="m-refs-item">
            <img src={item.preview || item.url} alt={`参考图 ${index + 1}`} />
            <button type="button" className="m-ref-remove" aria-label="移除参考图" onClick={() => onRemove(item.id)}>
              <CloseOutline fontSize={10} />
            </button>
          </figure>
        ))}
        {references.length < maxReferences && (
          <button type="button" className="m-refs-item m-refs-add m-pressable" aria-label="继续添加参考图" onClick={onAdd}>
            <AddOutline />
          </button>
        )}
      </div>
    </Sheet>
  );
}
