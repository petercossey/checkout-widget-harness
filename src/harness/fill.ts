// Drives native inputs so React/Formik treat the change exactly like user input.
// Why: React tracks input values internally. Assigning el.value directly is ignored.
// Calling the prototype's value setter and then firing a bubbling input/change event is not.

import * as adapter from './adapter.ts';
import { sleep } from './dom.ts';
import { getCheckout, onRequest, onRequestStart, type NetRequest } from './net.ts';

export interface Address {
  firstName?: string;
  lastName?: string;
  company?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  /** ISO code ('AU') or country name ('Australia'). */
  countryCode?: string;
  /** For countries with a state dropdown, the code ('NSW') or name ('New South Wales') both work. */
  stateOrProvince?: string;
  stateOrProvinceCode?: string;
  postalCode?: string;
  /** Store-specific custom fields by id, e.g. { field_25: 'Leave at door' }. */
  customFields?: Record<string, string>;
}

export interface FillOptions {
  /** Clear standard text fields the address doesn't include (e.g. a leftover company). Default false: a partial update. */
  replace?: boolean;
  /**
   * Resolve only after checkout has auto-saved the address (a consignment POST/PUT), about 1.7s after the last change.
   * Resolves early with saved: false when checkout won't save: nothing changed, or the form is incomplete.
   */
  waitForSave?: boolean;
  /** Longest wait for a save that has started. Default 10000ms. */
  timeout?: number;
}

export interface FillResult {
  ok: boolean;
  /** Keys that now hold the requested value (changed, or already set). With a saved address selected, this includes the keys carried over from it. */
  filled: string[];
  /** Keys that have no field on this store/country, or whose value wasn't a valid option. */
  missing: string[];
  /** Only with waitForSave: whether checkout saved the address. */
  saved?: boolean;
  /**
   * Only with waitForSave, when saved is false:
   * - 'unchanged': the form already had these values, so there was nothing to save.
   * - 'incomplete': checkout didn't start a save. It only auto-saves a valid form, so a required field is probably empty or invalid.
   * - 'rejected': the save request failed.
   * - 'timeout': a save started but didn't finish in time.
   */
  notSaved?: 'unchanged' | 'incomplete' | 'rejected' | 'timeout';
  error?: string;
}

type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type SaveOutcome = 'saved' | NonNullable<FillResult['notSaved']>;

const TEXT_FIELDS = ['firstName', 'lastName', 'company', 'address1', 'address2', 'city', 'postalCode'] as const;
const ADDRESS_KEYS = [...TEXT_FIELDS, 'phone', 'countryCode', 'stateOrProvince', 'stateOrProvinceCode'] as const;

// Auto-save is a 1700ms debounce after the last valid change (docs/checkout-internals.md §4). If no save request
// has started this long after our last change, checkout isn't going to send one.
const SAVE_START_GRACE = 2500;

/**
 * Sets a value the way a user would. Returns 'unchanged' if the value was already set,
 * and 'invalid' if a select has no matching option (matched by value or label, case-insensitive).
 */
export function setNativeValue(el: FieldElement, value: string): 'set' | 'unchanged' | 'invalid' {
  if (el instanceof HTMLSelectElement) {
    const wanted = value.trim().toLowerCase();
    const option = [...el.options].find((o) => o.value.toLowerCase() === wanted || o.text.trim().toLowerCase() === wanted);
    if (!option) return 'invalid';
    value = option.value;
  }
  if (el.value === value) return 'unchanged';
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  if (!setter) return 'invalid';
  setter.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  return 'set';
}

/**
 * The values in the shipping form right now, typed but not necessarily saved. Empty fields are ''.
 * Null when the form isn't ready, or when a saved address is selected (no manual fields: use getCheckout()).
 */
export function readShippingAddress(): Address | null {
  if (!adapter.isManualShippingFormVisible()) return null;
  const address: Address = {};
  for (const [key, el] of adapter.shippingFields()) {
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) continue;
    if (key.startsWith('customFields.')) (address.customFields ??= {})[key.slice('customFields.'.length)] = el.value;
    else if ((ADDRESS_KEYS as readonly string[]).includes(key)) address[key as (typeof ADDRESS_KEYS)[number]] = el.value;
  }
  return address;
}

export async function fillShippingAddress(address: Address, options: FillOptions = {}): Promise<FillResult> {
  const { waitForSave = false, replace = false, timeout = 10000 } = options;
  const result: FillResult = { ok: false, filled: [], missing: [] };

  if (!adapter.shippingAddressRoot()) return { ...result, error: 'shipping address form not ready' };

  // A selected saved address hides the manual fields. "Enter a new address" brings them back but
  // empties them (docs/checkout-internals.md §4a), so for a partial update start from the saved address.
  if (!replace && adapter.isSavedShippingAddressSelected()) {
    const current = consignmentAddress((await getCheckout())?.consignments?.[0]?.shippingAddress);
    if (!current) return { ...result, error: 'could not read the selected saved address' };
    if (matches(current, address)) return { ok: true, filled: [], missing: [], ...(waitForSave && { saved: false, notSaved: 'unchanged' as const }) };
    address = merge(current, address);
  }
  if (!(await adapter.openNewShippingAddressForm())) return { ...result, error: 'could not open the new-address form' };

  // Subscribe before changing anything, so we can't miss the save request.
  const save = waitForSave ? watchAddressSave(timeout) : undefined;
  let changed = false;

  const set = (key: string, value: string | undefined) => {
    if (value === undefined) return;
    const el = adapter.shippingField(key);
    const outcome = el ? setNativeValue(el, value) : 'invalid';
    (outcome === 'invalid' ? result.missing : result.filled).push(key);
    if (outcome === 'set') changed = true;
    return outcome;
  };

  const { countryCode, stateOrProvince, stateOrProvinceCode, phone, customFields, ...text } = address;

  // 1. Country first. Changing it swaps the state field for a different element,
  //    then clears the state value in an effect (a frame or two later; see
  //    SingleShippingForm.handleFieldChange). Wait for both before setting state.
  if (set('countryCode', countryCode) === 'set') await sleep(150);

  // 2. Plain text fields.
  for (const [key, value] of Object.entries(text)) set(key, value);
  if (replace) {
    for (const key of TEXT_FIELDS) {
      const el = key in text ? null : adapter.shippingField(key);
      if (el && setNativeValue(el, '') === 'set') changed = true;
    }
  }
  for (const [id, value] of Object.entries(customFields ?? {})) set(`customFields.${id}`, value);

  // 3. State: a select or a text input, depending on the country.
  const state = adapter.shippingStateField();
  const stateValue = state?.key === 'stateOrProvinceCode' ? (stateOrProvinceCode ?? stateOrProvince) : (stateOrProvince ?? stateOrProvinceCode);
  if (stateValue !== undefined) {
    if (state) set(state.key, stateValue);
    else result.missing.push('stateOrProvince');
  }

  // 4. Phone last, because its input can depend on the selected country.
  set('phone', phone);

  result.ok = result.missing.length === 0;
  if (save) {
    const outcome = await save(changed);
    result.saved = outcome === 'saved';
    if (outcome !== 'saved') result.notSaved = outcome;
  }
  return result;
}

/**
 * Watches for checkout's next shipping address save. Call the returned function after the last change.
 * It resolves 'unchanged' at once if nothing changed, 'incomplete' if no save starts within the grace
 * period, and otherwise with the result of the save.
 */
function watchAddressSave(timeout: number): (changed: boolean) => Promise<SaveOutcome> {
  const isAddressWrite = (e: NetRequest) => (e.method === 'POST' || e.method === 'PUT') && JSON.stringify(e.requestBody ?? '').includes('"address"');
  let started = false;
  let finish: (outcome: SaveOutcome) => void = () => {};
  const outcome = new Promise<SaveOutcome>((resolve) => (finish = resolve));
  const timers: ReturnType<typeof setTimeout>[] = [];

  const offStart = onRequestStart(adapter.API.consignments, (e) => {
    if (isAddressWrite(e)) started = true;
  });
  // Only count a save that started after we subscribed, not one already in flight.
  const offEnd = onRequest(adapter.API.consignments, (e) => {
    if (started && isAddressWrite(e)) done(e.status >= 200 && e.status < 300 ? 'saved' : 'rejected');
  });

  function done(value: SaveOutcome) {
    timers.forEach(clearTimeout);
    offStart();
    offEnd();
    finish(value);
  }

  return (changed) => {
    if (!changed) done('unchanged');
    else {
      timers.push(setTimeout(() => started || done('incomplete'), SAVE_START_GRACE));
      timers.push(setTimeout(() => done('timeout'), timeout));
    }
    return outcome;
  };
}

/** A consignment's shippingAddress (Storefront API shape) as an Address, skipping empty values. */
function consignmentAddress(raw: Record<string, unknown> | undefined): Address | null {
  if (!raw) return null;
  const address: Address = {};
  for (const key of ADDRESS_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value) address[key] = value;
  }
  if (Array.isArray(raw.customFields)) {
    for (const { fieldId, fieldValue } of raw.customFields as { fieldId?: string; fieldValue?: unknown }[]) {
      if (fieldId && typeof fieldValue === 'string' && fieldValue) (address.customFields ??= {})[fieldId] = fieldValue;
    }
  }
  return address;
}

/** The current address with the update applied. A new state replaces both state keys, so a stale code can't win. */
function merge(current: Address, update: Address): Address {
  const base = { ...current };
  if (update.stateOrProvince !== undefined || update.stateOrProvinceCode !== undefined) {
    delete base.stateOrProvince;
    delete base.stateOrProvinceCode;
  }
  const customFields = current.customFields || update.customFields ? { ...current.customFields, ...update.customFields } : undefined;
  return { ...base, ...update, ...(customFields && { customFields }) };
}

/** Whether every value in the update already matches the current address (case-insensitive; state by code or name). */
function matches(current: Address, update: Address): boolean {
  const same = (a: string | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
  const { customFields, stateOrProvince, stateOrProvinceCode, ...rest } = update;
  const state = stateOrProvinceCode ?? stateOrProvince;
  if (state !== undefined && !same(current.stateOrProvinceCode, state) && !same(current.stateOrProvince, state)) return false;
  if (Object.entries(rest).some(([key, value]) => value !== undefined && !same(current[key as keyof typeof rest], value))) return false;
  return Object.entries(customFields ?? {}).every(([id, value]) => same(current.customFields?.[id], value));
}
