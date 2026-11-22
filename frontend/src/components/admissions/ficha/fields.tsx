/**
 * The inputs of the ficha, one per schema type, read through a small form
 * context (the step, its values and errors). Labels, help, options and the
 * required rule come from the schema; the step components only place them.
 *
 * Phone-first: every control is ≥44 px tall with 16 px text (no iOS zoom),
 * short lists are tap-to-choose option cards (native radios, so arrows and
 * Space work), errors sit under the field and are announced with it.
 */
import { useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Info, Sparkles } from 'lucide-react';
import { checkCurp, cleanCurp, curpAgreementErrors, curpBirthDate, curpBornAbroad, curpSex, curpState, CURP_MESSAGES } from '@/lib/curp';
import { choicesFor, conditionMet, fieldId, isBlank, isHidden, isRequired, stepField } from './choices';
import { useFichaForm } from './context';
import type { Choice, FichaField, Values } from './types';

const today = () => new Date().toISOString().slice(0, 10);

function Help({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return <p id={id} className="mt-1.5 text-sm leading-snug text-muted">{text}</p>;
}

function ErrorText({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return <p id={id} className="mt-1.5 text-sm font-medium text-coral-700">{text}</p>;
}

function Label({ htmlFor, text, optional, as = 'label' }: { htmlFor?: string; text: string; optional?: string; as?: 'label' | 'legend' }) {
  const body = (
    <>
      <span className="font-semibold text-ink">{text}</span>
      {optional ? <>{' '}<span className="ml-1 text-xs font-normal text-subtle">({optional})</span></> : null}
    </>
  );
  if (as === 'legend') return <legend className="mb-2 block text-sm">{body}</legend>;
  return <label htmlFor={htmlFor} className="mb-1.5 block text-sm">{body}</label>;
}

const inputClass = (error?: string) => clsx(
  'input-field text-base',
  error && 'border-coral-400 focus:border-coral-400 focus:ring-coral-400/20',
);

interface FieldProps {
  name: string;
  /** Overrides the schema label (rare: «Escriba el país»). */
  label?: string;
  /** Boolean rendering: a switch row (default) or a checkbox card (consents). */
  as?: 'switch' | 'checkbox';
  autoComplete?: string;
  className?: string;
  /** Extra line under the field (CURP hint, age hint). */
  after?: ReactNode;
}

/** One schema field of the current step, rendered for its type. */
export function Field(props: FieldProps) {
  const form = useFichaForm();
  const spec = stepField(form.step, props.name);
  if (!spec || spec.read_only || isHidden(spec, form.values)) return null;
  switch (spec.type) {
    case 'select':
    case 'cycle':
      return <OptionCards spec={spec} {...props} />;
    case 'grade':
      return <GradeSelect spec={spec} {...props} />;
    case 'state':
      return <StateField spec={spec} {...props} />;
    case 'country':
      return <CountryField spec={spec} {...props} />;
    case 'boolean':
      return props.as === 'checkbox' ? <CheckboxCard spec={spec} {...props} /> : <SwitchRow spec={spec} {...props} />;
    case 'textarea':
      return <TextArea spec={spec} {...props} />;
    case 'curp':
      return <CurpField spec={spec} {...props} />;
    default:
      return <TextField spec={spec} {...props} />;
  }
}

interface SpecProps extends FieldProps { spec: FichaField }

/** Shared wiring of a field: id, describedby, label suffix, error. */
function useFieldBits(spec: FichaField) {
  const form = useFichaForm();
  const id = fieldId(form.step.key, spec.name);
  const error = form.errors[spec.name];
  const required = isRequired(spec, form.values);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, spec.help ? helpId : null].filter(Boolean).join(' ') || undefined;
  return {
    form, id, error, required, helpId, errorId, describedBy,
    optional: required || spec.type === 'boolean' ? undefined : form.copy.t('optionalMark'),
    value: form.values[spec.name],
  };
}

const INPUT_TYPES: Record<string, { type: string; inputMode?: 'text' | 'tel' | 'email' | 'numeric' | 'decimal'; autoComplete?: string; maxLength?: number; pattern?: string }> = {
  email: { type: 'email', inputMode: 'email', autoComplete: 'email' },
  phone: { type: 'tel', inputMode: 'tel', autoComplete: 'off' },
  extension: { type: 'text', inputMode: 'numeric', maxLength: 6, pattern: '[0-9]*' },
  postal_code: { type: 'text', inputMode: 'numeric', autoComplete: 'postal-code', maxLength: 5, pattern: '[0-9]*' },
  number: { type: 'text', inputMode: 'decimal' },
  date: { type: 'date' },
  text: { type: 'text' },
};

function TextField({ spec, label, autoComplete, className, after }: SpecProps) {
  const { form, id, error, required, helpId, errorId, describedBy, optional, value } = useFieldBits(spec);
  const kind = INPUT_TYPES[spec.type] ?? INPUT_TYPES.text;
  const input = (
    <input
      id={id}
      name={spec.name}
      type={kind.type}
      inputMode={kind.inputMode}
      autoComplete={autoComplete ?? kind.autoComplete ?? 'off'}
      maxLength={kind.maxLength ?? spec.max_length ?? undefined}
      pattern={kind.pattern}
      max={spec.type === 'date' ? today() : undefined}
      min={spec.type === 'date' ? '1900-01-01' : undefined}
      autoCapitalize={spec.type === 'email' ? 'none' : undefined}
      spellCheck={spec.type === 'email' ? false : undefined}
      aria-required={required || undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={clsx(inputClass(error), spec.unit && 'pr-14')}
      value={String(value ?? '')}
      onChange={(e) => form.set(spec.name, e.target.value)}
    />
  );
  return (
    <div className={className}>
      <Label htmlFor={id} text={label ?? spec.label} optional={optional} />
      {spec.unit ? (
        <div className="relative">
          {input}
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-muted" aria-hidden="true">{spec.unit}</span>
        </div>
      ) : input}
      <ErrorText id={errorId} text={error} />
      <Help id={helpId} text={spec.help} />
      {after}
    </div>
  );
}

function TextArea({ spec, label, className }: SpecProps) {
  const { form, id, error, required, helpId, errorId, describedBy, optional, value } = useFieldBits(spec);
  return (
    <div className={className}>
      <Label htmlFor={id} text={label ?? spec.label} optional={optional} />
      <textarea
        id={id}
        name={spec.name}
        rows={3}
        maxLength={spec.max_length ?? undefined}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(inputClass(error), 'min-h-[96px] resize-y')}
        value={String(value ?? '')}
        onChange={(e) => form.set(spec.name, e.target.value)}
      />
      <ErrorText id={errorId} text={error} />
      <Help id={helpId} text={spec.help} />
    </div>
  );
}

/** Grid of the option cards by how long the labels are (compact for «A+», list for occupations). */
function cardsGrid(options: Choice[]): { grid: string; compact: boolean } {
  const longest = Math.max(0, ...options.map((o) => o.label.length));
  if (longest <= 9 && options.length > 3) return { grid: 'grid-cols-3 sm:grid-cols-5', compact: true };
  if (longest <= 14) {
    const sm = options.length === 4 ? 'sm:grid-cols-4' : options.length > 2 ? 'sm:grid-cols-3' : '';
    return { grid: clsx('grid-cols-2', sm), compact: false };
  }
  return { grid: 'grid-cols-1 sm:grid-cols-2', compact: false };
}

/**
 * A short list as tap-to-choose cards: a radio group under one legend
 * (`radiogroup`, so it may say it is required and invalid).
 */
function OptionCards({ spec, label, className, after }: SpecProps) {
  const { form, id, error, required, helpId, errorId, optional, value } = useFieldBits(spec);
  const options = choicesFor(form.schema, spec);
  const { grid, compact } = cardsGrid(options);
  return (
    <fieldset
      id={id}
      role="radiogroup"
      tabIndex={-1}
      className={clsx('min-w-0 focus:outline-none', className)}
      aria-required={required || undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={[error ? errorId : null, spec.help ? helpId : null].filter(Boolean).join(' ') || undefined}
    >
      <Label as="legend" text={label ?? spec.label} optional={optional} />
      <div className={clsx('grid gap-2', grid)}>
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={clsx(
                // relative: the visually hidden radio stays inside its card (no scroll jump on focus).
                'relative flex min-h-[48px] cursor-pointer items-center rounded-md border bg-white text-[15px] leading-snug transition-colors',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-purple/40 has-[:focus-visible]:ring-offset-1',
                compact ? 'justify-center px-2 py-2 text-center' : 'px-3.5 py-2.5',
                checked ? 'border-purple bg-purple-light font-semibold text-purple ring-1 ring-purple' : error ? 'border-coral-400 text-ink' : 'border-line text-ink hover:border-purple/40',
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={id}
                value={o.value}
                checked={checked}
                onChange={() => form.set(spec.name, o.value)}
              />
              <span className="min-w-0 break-words">{o.label}</span>
            </label>
          );
        })}
      </div>
      <ErrorText id={errorId} text={error} />
      <Help id={helpId} text={spec.help} />
      {after}
    </fieldset>
  );
}

function NativeSelect({ id, value, onChange, error, required, describedBy, placeholder, children }: {
  id: string; value: string; onChange: (v: string) => void; error?: string; required: boolean; describedBy?: string; placeholder: string; children: ReactNode;
}) {
  return (
    <select
      id={id}
      className={inputClass(error)}
      value={value}
      aria-required={required || undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
  );
}

/** Grades grouped by level (13 options: a native list reads best on a phone). */
function GradeSelect({ spec, label, className, after }: SpecProps) {
  const { form, id, error, required, helpId, errorId, describedBy, optional, value } = useFieldBits(spec);
  const grades = choicesFor(form.schema, spec);
  const levels = form.schema.choices.niveles ?? [];
  const current = grades.find((g) => g.value === value);
  const level = levels.find((l) => l.value === current?.level);
  return (
    <div className={className}>
      <Label htmlFor={id} text={label ?? spec.label} optional={optional} />
      <NativeSelect id={id} value={String(value ?? '')} onChange={(v) => form.set(spec.name, v)} error={error} required={required}
        describedBy={describedBy} placeholder={form.copy.t('selectPlaceholder')}>
        {levels.map((l) => (
          <optgroup key={l.value} label={l.label}>
            {grades.filter((g) => g.level === l.value).map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </optgroup>
        ))}
      </NativeSelect>
      <ErrorText id={errorId} text={error} />
      <Help id={helpId} text={spec.help} />
      {level ? (
        <p className="mt-2 inline-flex items-center rounded-full bg-cream px-3 py-1 text-xs font-semibold text-ink">
          {form.copy.t('levelLabel')}: {level.label}
        </p>
      ) : null}
      {after}
    </div>
  );
}

/** The 32 states while born in México (or always, for the address); free text abroad. */
function StateField({ spec, label, className }: SpecProps) {
  const { form, id, error, required, helpId, errorId, describedBy, optional, value } = useFieldBits(spec);
  const listed = !spec.choices_if || conditionMet(spec.choices_if, form.values);
  if (!listed) {
    return (
      <div className={className}>
        <Label htmlFor={id} text={form.copy.t('stateOtherLabel')} optional={optional} />
        <input id={id} type="text" autoComplete="off" className={inputClass(error)} maxLength={spec.max_length ?? undefined}
          aria-invalid={error ? true : undefined} aria-describedby={describedBy} value={String(value ?? '')}
          onChange={(e) => form.set(spec.name, e.target.value)} />
        <ErrorText id={errorId} text={error} />
      </div>
    );
  }
  const states = choicesFor(form.schema, spec);
  return (
    <div className={className}>
      <Label htmlFor={id} text={label ?? spec.label} optional={optional} />
      <NativeSelect id={id} value={String(value ?? '')} onChange={(v) => form.set(spec.name, v)} error={error} required={required}
        describedBy={describedBy} placeholder={form.copy.t('selectPlaceholder')}>
        {states.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        {/* A state on file that is not on the list (an old draft) still shows. */}
        {value && !states.some((s) => s.value === value) ? <option value={String(value)}>{String(value)}</option> : null}
      </NativeSelect>
      <ErrorText id={errorId} text={error} />
      <Help id={helpId} text={spec.help} />
    </div>
  );
}

const MEXICO = 'México';

/** México (the default) or another country typed in. */
function CountryField({ spec, className }: SpecProps) {
  const { form, id, error, optional, value, errorId } = useFieldBits(spec);
  const text = String(value ?? '');
  // «Otro país» while a country other than México is typed, or picked and still blank.
  const [picked, setPicked] = useState(false);
  const other = text !== MEXICO && (text !== '' || picked);
  const choose = (abroad: boolean) => {
    setPicked(abroad);
    form.set(spec.name, abroad ? '' : MEXICO);
  };
  const card = (checked: boolean) => clsx(
    'relative flex min-h-[48px] cursor-pointer items-center justify-center rounded-md border bg-white px-3 py-2 text-center text-[15px] transition-colors',
    'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-purple/40 has-[:focus-visible]:ring-offset-1',
    checked ? 'border-purple bg-purple-light font-semibold text-purple ring-1 ring-purple' : 'border-line text-ink hover:border-purple/40',
  );
  return (
    <div className={className}>
      <fieldset id={id} tabIndex={-1} className="min-w-0 focus:outline-none" aria-describedby={error && !other ? errorId : undefined}>
        <Label as="legend" text={spec.label} optional={optional} />
        <div className="grid grid-cols-2 gap-2">
          <label className={card(!other)}>
            <input type="radio" className="sr-only" name={id} checked={!other} onChange={() => choose(false)} />
            {form.copy.t('countryMexico')}
          </label>
          <label className={card(other)}>
            <input type="radio" className="sr-only" name={id} checked={other} onChange={() => choose(true)} />
            {form.copy.t('countryOther')}
          </label>
        </div>
      </fieldset>
      {other ? (
        <div className="mt-3">
          <Label htmlFor={`${id}-text`} text={form.copy.t('countryOtherLabel')} />
          <input id={`${id}-text`} type="text" autoComplete="off" className={inputClass(error)} maxLength={spec.max_length ?? undefined}
            aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
            value={text} onChange={(e) => form.set(spec.name, e.target.value)} />
        </div>
      ) : null}
      <ErrorText id={errorId} text={error} />
    </div>
  );
}

function SwitchRow({ spec, label, className }: SpecProps) {
  const { form, id, error, helpId, errorId, describedBy, value } = useFieldBits(spec);
  const on = value === true;
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={clsx(
          'relative flex min-h-[56px] cursor-pointer items-center justify-between gap-4 rounded-md border bg-white px-4 py-3',
          'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-purple/40 has-[:focus-visible]:ring-offset-1',
          error ? 'border-coral-400' : on ? 'border-purple/50' : 'border-line',
        )}
      >
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold text-ink">{label ?? spec.label}</span>
          {spec.help ? <span id={helpId} className="mt-0.5 block text-sm text-muted">{spec.help}</span> : null}
        </span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={on}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => form.set(spec.name, e.target.checked)}
        />
        <span
          aria-hidden="true"
          className={clsx(
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none',
            on ? 'bg-purple' : 'bg-line',
          )}
        >
          <span className={clsx('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none', on ? 'translate-x-6' : 'translate-x-1')} />
        </span>
      </label>
      <ErrorText id={errorId} text={error} />
    </div>
  );
}

function CheckboxCard({ spec, label, className }: SpecProps) {
  const { form, id, error, helpId, errorId, describedBy, value } = useFieldBits(spec);
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={clsx(
          'flex min-h-[56px] cursor-pointer items-start gap-3 rounded-md border bg-white px-4 py-3.5',
          'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-purple/40 has-[:focus-visible]:ring-offset-1',
          error ? 'border-coral-400' : value === true ? 'border-purple/50 bg-purple-light/40' : 'border-line',
        )}
      >
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 rounded-sm border-line text-purple focus:outline-none"
          checked={value === true}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => form.set(spec.name, e.target.checked)}
        />
        <span className="min-w-0 text-[15px] leading-snug text-ink">
          {label ?? spec.label}
          {spec.help ? <span id={helpId} className="mt-1 block text-sm text-muted">{spec.help}</span> : null}
        </span>
      </label>
      <ErrorText id={errorId} text={error} />
    </div>
  );
}

/** Which fields of the step a valid CURP may fill (only when they are blank). */
export interface CurpTargets { dob: string; sex: string; state: string; country: string }

const CURP_TARGETS: Record<string, CurpTargets> = {
  child_curp: { dob: 'child_dob', sex: 'child_sex', state: 'child_birth_state', country: 'child_birth_country' },
  curp: { dob: 'dob', sex: 'sex', state: 'birth_state', country: 'birth_country' },
};

/**
 * CURP: uppercase as typed, checked like the server once it has 18
 * characters, and when valid it fills the birth date, the sex and the state
 * of birth that are still blank (never overwrites what the family typed;
 * a disagreement shows the server's message instead).
 */
function CurpField({ spec, label, className, after }: SpecProps) {
  const { form, id, error, required, helpId, errorId, optional, value } = useFieldBits(spec);
  const [touched, setTouched] = useState(false);
  const [filled, setFilled] = useState(false);
  const curp = cleanCurp(String(value ?? ''));
  const targets = CURP_TARGETS[spec.name];
  const check = checkCurp(curp);
  const live = curp.length === 18 ? check.error : touched && curp.length > 0 ? CURP_MESSAGES.length.replace('{n}', String(curp.length)) : null;
  const agreement = targets && !live ? curpAgreementErrors(curp, String(form.values[targets.dob] ?? ''), String(form.values[targets.sex] ?? '')) : [];
  const shown = error || live || agreement[0] || undefined;

  const onChange = (raw: string) => {
    const next = cleanCurp(raw).slice(0, 18);
    form.set(spec.name, next);
    if (!targets || next.length !== 18 || checkCurp(next).error) return;
    const patch: Values = {};
    const dob = curpBirthDate(next);
    const sex = curpSex(next);
    const state = curpState(next);
    if (dob && isBlank(form.values[targets.dob])) patch[targets.dob] = dob;
    if (sex && isBlank(form.values[targets.sex])) patch[targets.sex] = sex;
    const country = String(form.values[targets.country] ?? '');
    if (state && !curpBornAbroad(next) && (country === '' || country === MEXICO)) {
      if (country === '') patch[targets.country] = MEXICO;
      if (isBlank(form.values[targets.state])) patch[targets.state] = state;
    }
    if (Object.keys(patch).length) {
      form.setMany(patch);
      setFilled(true);
    }
  };

  const describedBy = [shown ? errorId : null, spec.help ? helpId : null, filled ? `${id}-filled` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <Label htmlFor={id} text={label ?? spec.label} optional={optional} />
      <input
        id={id}
        name={spec.name}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        maxLength={22}
        aria-required={required || undefined}
        aria-invalid={shown ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(inputClass(shown), 'font-mono uppercase tracking-wider')}
        value={curp}
        onBlur={() => setTouched(true)}
        onChange={(e) => onChange(e.target.value)}
      />
      <ErrorText id={errorId} text={shown} />
      <Help id={helpId} text={spec.help} />
      <p id={`${id}-filled`} aria-live="polite" className={clsx('flex items-start gap-1.5 text-sm text-green-dark', filled ? 'mt-1.5' : 'sr-only')}>
        {filled ? <><Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{form.copy.t('curpFilled')}</> : null}
      </p>
      {after}
    </div>
  );
}

/** A soft note (not an error) under a field: the age hint, the CURP help. */
export function FieldNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <p className={clsx('mt-2 flex items-start gap-2 rounded-md px-3 py-2 text-sm leading-snug',
      tone === 'warn' ? 'bg-amber-bright/15 text-ink' : 'bg-cream text-muted')} role={tone === 'warn' ? 'status' : undefined}>
      <Info className={clsx('mt-0.5 h-4 w-4 shrink-0', tone === 'warn' ? 'text-amber' : 'text-purple')} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** The step's fields that no layout placed (a field the server adds later still shows). */
export function RestFields({ placed }: { placed: readonly string[] }) {
  const { step } = useFichaForm();
  const rest = step.fields.filter((f) => !f.read_only && !placed.includes(f.name));
  if (!rest.length) return null;
  return <>{rest.map((f) => <Field key={f.name} name={f.name} />)}</>;
}
