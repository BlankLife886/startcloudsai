import {useEffect, useRef, useState} from 'react';
import {Popover, Select} from 'radix-ui';
import {CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Minus, Plus} from 'lucide-react';
import {localDate} from './presentation.js';
import './Controls.css';

// Keep popups in the console theme and, for forms, inside the native dialog's top layer.
function usePopupContainer(trigger) {
  const [container, setContainer] = useState(null);
  useEffect(() => {
    setContainer(trigger.current?.closest('dialog') || trigger.current?.closest('.dap'));
  }, [trigger]);
  return container;
}

export function ConsoleSelect({label, value, onChange, options, disabled = false, placeholder = '请选择', className = ''}) {
  const trigger = useRef(null);
  const container = usePopupContainer(trigger);
  return <span className={`dap-select ${className}`}>
    <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger ref={trigger} className="dap-select-trigger" aria-label={label}>
        <Select.Value placeholder={placeholder}/>
        <Select.Icon asChild><ChevronDown size={15}/></Select.Icon>
      </Select.Trigger>
      {container && <Select.Portal container={container}>
        <Select.Content className="dap-select-menu" position="popper" sideOffset={8} collisionPadding={14} align="start">
          <Select.ScrollUpButton className="dap-select-scroll"><ChevronUp size={14}/></Select.ScrollUpButton>
          <Select.Viewport className="dap-select-options">
            {options.map(option => <Select.Item className="dap-select-option" key={option.value} value={option.value} disabled={option.disabled} textValue={option.label}>
              <Select.ItemText>{option.label}</Select.ItemText>
              <Select.ItemIndicator className="dap-select-check"><Check size={15}/></Select.ItemIndicator>
            </Select.Item>)}
          </Select.Viewport>
          <Select.ScrollDownButton className="dap-select-scroll"><ChevronDown size={14}/></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>}
    </Select.Root>
  </span>;
}

export function Checkbox({switchStyle = false, ...props}) {
  return <span className={`dap-check-control${switchStyle ? ' is-switch' : ''}`}>
    <input type="checkbox" role={switchStyle ? 'switch' : undefined} {...props}/>
    <span className="dap-check-visual" aria-hidden="true">{!switchStyle && <Check size={13} strokeWidth={3}/>}</span>
  </span>;
}

export function NumberField({label, value, onChange, min, max, step = 1, ...props}) {
  const input = useRef(null);
  const adjust = direction => {
    if (step !== 'any') {
      // Snap typed fractions to the next valid step without mutating a controlled input.
      const increment = Number(step);
      const offset = (Number(value || min) - min) / increment;
      const index = direction > 0 ? Math.floor(offset) + 1 : Math.ceil(offset) - 1;
      const next = value === '' ? min : min + index * increment;
      onChange(String(Math.min(max, Math.max(min, next))));
    } else {
      const next = Math.min(max, Math.max(min, Number(value || 0) + direction * 0.1));
      onChange(String(Number(next.toFixed(6))));
    }
    input.current?.focus();
  };
  return <span className="dap-number-field">
    <input {...props} ref={input} type="number" inputMode={step === 'any' ? 'decimal' : 'numeric'} aria-label={label} min={min} max={max} step={step} value={value} onChange={event => onChange(event.target.value)}/>
    <span className="dap-number-actions" data-click-guard="repeat">
      <button type="button" aria-label={`减少 ${label}`} disabled={props.disabled || (value !== '' && Number(value) <= min)} onClick={() => adjust(-1)}><Minus size={13}/></button>
      <button type="button" aria-label={`增加 ${label}`} disabled={props.disabled || (value !== '' && Number(value) >= max)} onClick={() => adjust(1)}><Plus size={13}/></button>
    </span>
  </span>;
}

const fromISO = value => new Date(`${value}T12:00:00`);
const toISO = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const monthStart = date => new Date(date.getFullYear(), date.getMonth(), 1, 12);
const addDays = (date, amount) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12);
const addMonths = (date, amount) => {
  const next = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
  next.setDate(Math.min(date.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
  return next;
};

export function DateField({value, onChange, min = localDate(), disabled = false}) {
  const trigger = useRef(null);
  const container = usePopupContainer(trigger);
  const [open, setOpen] = useState(false);
  const initial = value && value >= min ? value : min;
  const [activeDay, setActiveDay] = useState(initial);
  const [month, setMonth] = useState(() => monthStart(fromISO(initial)));
  const dayButtons = useRef(new Map());
  const focusAfterRender = useRef(false);
  const today = localDate();
  const minimum = fromISO(min);
  const chosenDate = value ? fromISO(value) : null;
  const caption = `${month.getFullYear()}年${month.getMonth() + 1}月`;
  const firstDay = addDays(month, -((month.getDay() + 6) % 7));
  const days = Array.from({length: 42}, (_, index) => addDays(firstDay, index));

  useEffect(() => {
    if (open && focusAfterRender.current) {
      dayButtons.current.get(activeDay)?.focus();
      focusAfterRender.current = false;
    }
  }, [activeDay, month, open]);

  const changeOpen = next => {
    if (next) {
      const anchor = value && value >= min ? value : min;
      setActiveDay(anchor);
      setMonth(monthStart(fromISO(anchor)));
    }
    setOpen(next);
  };
  const move = (date, focus = true) => {
    const next = date < minimum ? minimum : date;
    focusAfterRender.current = focus;
    setActiveDay(toISO(next));
    setMonth(monthStart(next));
  };
  const pick = date => {
    onChange(date);
    setOpen(false);
  };
  const onDayKey = (event, date) => {
    let next;
    if (event.key === 'ArrowLeft') next = addDays(date, -1);
    else if (event.key === 'ArrowRight') next = addDays(date, 1);
    else if (event.key === 'ArrowUp') next = addDays(date, -7);
    else if (event.key === 'ArrowDown') next = addDays(date, 7);
    else if (event.key === 'Home') next = addDays(date, -((date.getDay() + 6) % 7));
    else if (event.key === 'End') next = addDays(date, 6 - ((date.getDay() + 6) % 7));
    else if (event.key === 'PageUp') next = addMonths(date, event.shiftKey ? -12 : -1);
    else if (event.key === 'PageDown') next = addMonths(date, event.shiftKey ? 12 : 1);
    if (next) { event.preventDefault(); move(next); }
  };

  return <Popover.Root open={open} onOpenChange={changeOpen}>
    <Popover.Trigger ref={trigger} type="button" className={`dap-date-trigger${value ? ' has-value' : ''}`} aria-label="到期日期" disabled={disabled}>
      <CalendarDays size={17}/>
      <span>{chosenDate ? `${chosenDate.getFullYear()}年${chosenDate.getMonth() + 1}月${chosenDate.getDate()}日` : '长期有效'}</span>
      <ChevronDown size={15}/>
    </Popover.Trigger>
    {container && <Popover.Portal container={container}>
      <Popover.Content className="dap-calendar" aria-label="选择到期日期" sideOffset={8} collisionPadding={14} align="start"
        onOpenAutoFocus={event => { event.preventDefault(); dayButtons.current.get(activeDay)?.focus(); }}
        onEscapeKeyDown={event => event.stopPropagation()}>
        <header data-click-guard="repeat">
          <button type="button" className="dap-calendar-nav" aria-label="上个月" disabled={month <= monthStart(minimum)} onClick={() => move(addMonths(fromISO(activeDay), -1), false)}><ChevronLeft size={17}/></button>
          <strong aria-live="polite">{caption}</strong>
          <button type="button" className="dap-calendar-nav" aria-label="下个月" onClick={() => move(addMonths(fromISO(activeDay), 1), false)}><ChevronRight size={17}/></button>
        </header>
        <div className="dap-calendar-grid" role="grid" aria-label={caption}>
          <div role="row" className="dap-calendar-weekdays">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span role="columnheader" key={day}>{day}</span>)}</div>
          {Array.from({length: 6}, (_, week) => <div role="row" key={week}>
            {days.slice(week * 7, week * 7 + 7).map(date => {
              const key = toISO(date);
              return <div role="gridcell" key={key} aria-selected={value === key}>
                <button type="button" ref={node => { if (node) dayButtons.current.set(key, node); else dayButtons.current.delete(key); }}
                  className={`dap-calendar-day${date.getMonth() !== month.getMonth() ? ' is-outside' : ''}${value === key ? ' is-selected' : ''}`}
                  aria-label={key} aria-current={key === today ? 'date' : undefined} disabled={key < min} tabIndex={key === activeDay ? 0 : -1}
                  onFocus={() => setActiveDay(key)} onKeyDown={event => onDayKey(event, date)} onClick={() => pick(key)}>{date.getDate()}</button>
              </div>;
            })}
          </div>)}
        </div>
        <footer><button type="button" onClick={() => pick('')}>长期有效</button><button type="button" disabled={today < min} onClick={() => pick(today)}>今天</button></footer>
      </Popover.Content>
    </Popover.Portal>}
  </Popover.Root>;
}
