import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { evaluateArithmetic } from '../../lib/arithmetic';
import { cn } from '../../lib/cn';
import { focusRing } from './Button';

export const inputClass = cn(
  'h-9 w-full min-w-0 rounded-md border border-line-strong bg-raised px-2.5 text-[13px] text-ink placeholder:text-ink-3',
  'disabled:opacity-45 aria-invalid:border-danger-solid aria-invalid:text-danger max-lg:h-11 max-lg:text-base',
  focusRing,
);

export const labelClass = 'block text-xs text-ink-2';

type FieldProps = { label: string; hint?: ReactNode; children: (id: string) => ReactNode; className?: string; inline?: boolean };

/** Label + control + optional hint, wired together by id. `inline` puts the label left of the control. */
export const Field = ({ label, hint, children, className, inline = false }: FieldProps) => {
  const id = useId();
  return (
    <div className={cn(inline ? 'grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1' : 'space-y-1', className)}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children(id)}
      {hint ? <div className={cn('text-xs text-ink-3', { 'col-span-2': inline })}>{hint}</div> : null}
    </div>
  );
};

type NumberFieldProps = {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  hint?: ReactNode;
  disabled?: boolean;
  /** Short visible prefix inside the input (e.g. "W"); the full label stays the accessible name. */
  prefix?: string;
  suffix?: string;
  /** Apply the value shortly after typing stops, not only on blur/Enter. */
  live?: boolean;
};

/** How long typing has to pause before a live field applies its value. */
const LIVE_DELAY_MS = 450;

/**
 * Integer input where an empty value means null ("auto"). Accepts arithmetic ("1200/2", "640*2+20").
 * Commits on blur/Enter so typing isn't interrupted, or also after a pause when `live`.
 */
export const NumberField = ({ label, value, onChange, min = 1, max = 16384, placeholder = 'auto', hint, disabled, prefix, suffix, live = false }: NumberFieldProps) => {
  const id = useId();
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const liveTimer = useRef<number | undefined>(undefined);

  const parse = (text: string): number | null => {
    const result = evaluateArithmetic(text);
    return result === null ? null : Math.min(max, Math.max(min, Math.round(result)));
  };

  useEffect(() => {
    // Keep what's typed ("1200/2") while it already stands for this value.
    setDraft((current) => (current.trim() !== '' && parse(current) === value ? current : value === null ? '' : String(value)));
  }, [value]);

  useEffect(() => () => window.clearTimeout(liveTimer.current), []);

  const commit = () => {
    window.clearTimeout(liveTimer.current);
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (value !== null) onChange(null);
      return;
    }
    const parsed = parse(trimmed);
    if (parsed === null) {
      setDraft(value === null ? '' : String(value));
      return;
    }
    setDraft(String(parsed));
    if (parsed !== value) onChange(parsed);
  };

  const edit = (text: string) => {
    setDraft(text);
    if (!live) return;
    window.clearTimeout(liveTimer.current);
    const parsed = parse(text);
    if (parsed === null || parsed === value) return;
    liveTimer.current = window.setTimeout(() => onChange(parsed), LIVE_DELAY_MS);
  };

  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className={prefix ? 'sr-only' : labelClass}>
        {label}
      </label>
      <div
        className={cn(
          'flex h-9 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 font-mono text-[13px] max-lg:h-11',
          'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
          { 'opacity-45': disabled },
        )}
      >
        {prefix ? (
          <span aria-hidden="true" className="text-ink-3">
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          type="text"
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="off"
          placeholder={placeholder}
          value={draft}
          disabled={disabled}
          className="w-full min-w-0 bg-transparent text-ink outline-none placeholder:text-ink-3 max-lg:text-base"
          onChange={(event) => edit(event.target.value.replace(/[^\d\s.,+\-*/×÷()]/g, ''))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              window.clearTimeout(liveTimer.current);
              const base = value ?? 0;
              const next = Math.min(max, Math.max(min, base + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1)));
              onChange(next);
            }
          }}
        />
        {suffix ? (
          <span aria-hidden="true" className="text-xs text-ink-3">
            {suffix}
          </span>
        ) : null}
      </div>
      {hint ? <div className="text-xs text-ink-3">{hint}</div> : null}
    </div>
  );
};

type SliderProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  valueLabel?: string;
  className?: string;
};

export const Slider = ({ label, value, onChange, min, max, step = 1, disabled, valueLabel, className }: SliderProps) => {
  const id = useId();
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
        <span className="font-mono text-xs text-ink-2">{valueLabel ?? value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn('block h-5 w-full accent-primary disabled:opacity-45 max-lg:h-8', focusRing)}
      />
    </div>
  );
};

type SelectProps<T extends string> = {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  className?: string;
};

export const Select = <T extends string>({ label, value, options, onChange, disabled, hideLabel, className }: SelectProps<T>) => {
  const id = useId();
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : labelClass}>
        {label}
      </label>
      <select id={id} value={value} disabled={disabled} className={cn(inputClass, 'pr-7')} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

type ToggleProps = { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: ReactNode; disabled?: boolean };

export const Toggle = ({ label, checked, onChange, hint, disabled }: ToggleProps) => {
  const id = useId();
  return (
    <div className="space-y-0.5">
      <div className="flex min-h-6 items-center gap-2 max-lg:min-h-11">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className={cn('size-4 shrink-0 rounded accent-primary disabled:opacity-45', focusRing)}
        />
        <label htmlFor={id} className="text-[13px] text-ink">
          {label}
        </label>
      </div>
      {hint ? <div className="pl-6 text-xs text-ink-3">{hint}</div> : null}
    </div>
  );
};

type ColorInputProps = { value: string; onChange: (value: string) => void; label: string; disabled?: boolean; id?: string; className?: string };

export const ColorInput = ({ value, onChange, label, disabled, id, className }: ColorInputProps) => (
  <input
    id={id}
    type="color"
    aria-label={id ? undefined : label}
    value={value}
    disabled={disabled}
    onChange={(event) => onChange(event.target.value)}
    className={cn(
      'h-8 w-9 shrink-0 cursor-pointer rounded-md border border-line-strong bg-raised p-0.5 disabled:cursor-not-allowed disabled:opacity-45 max-lg:h-11 max-lg:w-11',
      focusRing,
      className,
    )}
  />
);
