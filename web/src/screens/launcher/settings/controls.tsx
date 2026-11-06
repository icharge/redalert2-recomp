import { useId, type KeyboardEvent, type ReactNode } from "react";
import { InfoTip } from "../../../components/InfoTip";
import styles from "./controls.module.css";

export { InfoTip };

/** A settings row: label (with an optional ⓘ) on the left, the control on the right. */
export function Row({
  label,
  info,
  htmlFor,
  children,
  disabled,
}: {
  label: string;
  info?: string;
  htmlFor?: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={styles.row} data-disabled={disabled || undefined}>
      <span className={styles.label}>
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {info && <InfoTip text={info} />}
      </span>
      <div className={styles.control}>{children}</div>
    </div>
  );
}

/** A group of rows under a small uppercase heading. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h2 id={id} className={styles.groupTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A square on/off switch. */
export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  info,
  keyHint,
}: {
  label: string;
  checked: boolean;
  onChange(on: boolean): void;
  disabled?: boolean;
  info?: string;
  /** the key that does the same, shown beside the switch */
  keyHint?: string;
}) {
  return (
    <Row label={label} {...(info ? { info } : {})} {...(disabled ? { disabled } : {})}>
      {keyHint && <kbd className={styles.keyHint}>{keyHint}</kbd>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={styles.switch}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.knob} />
      </button>
    </Row>
  );
}

function arrowStep(event: KeyboardEvent): number {
  if (event.key === "ArrowRight" || event.key === "ArrowDown") return 1;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") return -1;
  return 0;
}

/** One choice of a few, as a row of square buttons (a radio group). */
export function Segmented<T extends string | number>({
  label,
  value,
  choices,
  onChange,
  info,
}: {
  label: string;
  value: T;
  /** `name` is the accessible name when the label alone is ambiguous on the page */
  choices: readonly { value: T; label: string; name?: string }[];
  onChange(value: T): void;
  info?: string;
}) {
  const index = Math.max(
    0,
    choices.findIndex((choice) => choice.value === value),
  );
  return (
    <Row label={label} {...(info ? { info } : {})}>
      <div
        role="radiogroup"
        aria-label={label}
        className={styles.segmented}
        onKeyDown={(event) => {
          const step = arrowStep(event);
          if (!step) return;
          event.preventDefault();
          const next = choices[(index + step + choices.length) % choices.length];
          if (next) {
            onChange(next.value);
            const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]");
            buttons[(index + step + choices.length) % choices.length]?.focus();
          }
        }}
      >
        {choices.map((choice) => (
          <button
            key={String(choice.value)}
            type="button"
            role="radio"
            aria-checked={choice.value === value}
            tabIndex={choice.value === value ? 0 : -1}
            aria-label={choice.name}
            className={styles.segment}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </Row>
  );
}

/**
 * A value on a scale shown as square pips (volumes, speeds). It is one slider for keyboard and screen
 * readers: arrow keys move one pip, Home and End go to the ends; clicking a pip picks it.
 */
export function PipBar({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = String,
  info,
  low,
  high,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
  format?: (value: number) => string;
  info?: string;
  /** words at the two ends, such as Slow and Fast */
  low?: string;
  high?: string;
}) {
  const pips: number[] = [];
  for (let at = min === 0 && step > 1 ? step : min; at <= max; at += step) pips.push(at);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const set = (next: number) => {
    const clamped = clamp(next);
    if (clamped !== value) onChange(clamped);
  };
  return (
    <Row label={label} {...(info ? { info } : {})}>
      <div className={styles.pipRow}>
        {low && <span className={styles.end}>{low}</span>}
        <div
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={format(value)}
          className={styles.pips}
          onKeyDown={(event) => {
            const delta = arrowStep(event);
            if (delta) {
              event.preventDefault();
              set(value + delta * step);
            } else if (event.key === "Home") {
              event.preventDefault();
              set(min);
            } else if (event.key === "End") {
              event.preventDefault();
              set(max);
            }
          }}
        >
          {pips.map((at) => (
            <span
              key={at}
              className={styles.pip}
              data-on={at <= value || undefined}
              aria-hidden="true"
              onClick={() => set(at)}
            />
          ))}
        </div>
        {high && <span className={styles.end}>{high}</span>}
        <span className={styles.value}>{format(value)}</span>
      </div>
    </Row>
  );
}
