// Shared keyboard navigation for forms:
//  - focusFirstField: focus the first fillable field when a form opens.
//  - handleEnterNavigation: Enter moves focus to the next field (DOM order,
//    which every form lays out to match its visual order) instead of
//    submitting early. Enter on the last field keeps the browser's default,
//    so implicit submission still happens exactly as before.
//
// Used by <Form> (components/ui/form.tsx); formless field groups can attach
// handleEnterNavigation / autoFocusFirstFieldRef directly to their container.

// Opt-out marker: Enter inside an element carrying this attribute is ignored.
export const ENTER_NAV_OFF_ATTR = 'data-enter-navigation';

const FIELD_SELECTOR =
  'input, select, textarea, [contenteditable]:not([contenteditable="false"])';

// Inputs that are not "fields" to type into: Enter keeps its native meaning
// (activate the button / open the file picker) and they are never a target.
const NON_FIELD_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);

function isContentEditable(el: Element): boolean {
  return !!el.closest('[contenteditable]:not([contenteditable="false"])');
}

function isNavigableField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && NON_FIELD_INPUT_TYPES.has(el.type)) return false;
  if ((el as HTMLInputElement).disabled) return false;
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly) return false;
  if (el.getAttribute('tabindex') === '-1') return false;
  if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  // Fields inside a collapsed <details> are not visible.
  const details = el.closest('details');
  if (details && !details.open) return false;
  // Real browsers: skip anything not rendered (display:none, collapsed sections).
  const visibility = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  if (typeof visibility === 'function' && !visibility.call(el)) return false;
  return true;
}

/** Fillable fields inside `container`, in DOM order (one entry per radio group). */
export function getNavigableFields(container: HTMLElement): HTMLElement[] {
  const seenRadioGroups = new Set<string>();
  const fields: HTMLElement[] = [];
  container.querySelectorAll<HTMLElement>(FIELD_SELECTOR).forEach((el) => {
    // Nested contenteditable nodes belong to their outermost editor.
    if (el.parentElement && isContentEditable(el.parentElement)) return;
    if (!isNavigableField(el)) return;
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
      if (seenRadioGroups.has(el.name)) return;
      seenRadioGroups.add(el.name);
    }
    fields.push(el);
  });
  return fields;
}

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement) return !NON_FIELD_INPUT_TYPES.has(el.type);
  return el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || isContentEditable(el);
}

/**
 * Focus the first fillable field in `container`, unless doing so would fight
 * another focus owner:
 *  - focus is already inside the container (e.g. a field's own `autoFocus`);
 *  - for a non-modal (page) form, the user is already in a field elsewhere
 *    (e.g. a second form on the same page).
 * Forms inside a dialog (DialogOverlay) always take focus when they open.
 */
export function focusFirstField(container: HTMLElement): void {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (active && active !== document.body && container.contains(active)) return;
  const inDialog = !!container.closest('[data-dialog-overlay]');
  if (!inDialog && isEditableElement(active)) return;

  const first = getNavigableFields(container)[0];
  if (first) {
    first.focus();
    return;
  }
  // A rich-text editor mounts its editable node a tick after the form; retry once.
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      if (!container.isConnected) return;
      const now = document.activeElement;
      if (now && now !== document.body && container.contains(now)) return;
      getNavigableFields(container)[0]?.focus();
    });
  }
}

/** Stable callback ref: focuses the first field when the element mounts. */
export function autoFocusFirstFieldRef(node: HTMLElement | null): void {
  if (node) focusFirstField(node);
}

/**
 * onKeyDown handler for a form (or any container of fields). Moves focus to
 * the next field on Enter; leaves the event alone when:
 *  - another handler already handled it (defaultPrevented — e.g. a time field
 *    that opens its picker on Enter, or a combobox selecting an option);
 *  - a modifier is held, or an IME composition is in progress;
 *  - the target is a textarea / rich-text editor (Enter = new line), a button,
 *    a link, or a file input;
 *  - the target is an expanded combobox (aria-expanded="true");
 *  - the target is the last field — the browser default (implicit submit via
 *    the form's enabled submit button, if any) applies, as before.
 */
export function handleEnterNavigation(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Enter' || e.defaultPrevented) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.nativeEvent.isComposing) return;

  const container = e.currentTarget;
  const target = e.target as HTMLElement;
  // React events bubble through portals: ignore keys from a nested dialog's
  // form that is not actually inside this container in the DOM.
  if (!container.contains(target)) return;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (target instanceof HTMLInputElement && NON_FIELD_INPUT_TYPES.has(target.type)) return;
  if (target.getAttribute('aria-expanded') === 'true') return;
  if (target.closest(`[${ENTER_NAV_OFF_ATTR}="off"]`)) return;

  const fields = getNavigableFields(container);
  // A radio group is represented by its first radio, so locate the group.
  const index = target instanceof HTMLInputElement && target.type === 'radio' && target.name
    ? fields.findIndex((f) => f instanceof HTMLInputElement && f.type === 'radio' && f.name === target.name)
    : fields.indexOf(target);
  if (index === -1) return;
  const next = fields[index + 1];
  if (!next) return;

  if (target instanceof HTMLSelectElement) {
    // Don't cancel Enter on a <select>: where the browser routes it to an
    // open dropdown it commits the highlighted option. Move focus afterwards.
    setTimeout(() => next.focus(), 0);
    return;
  }
  e.preventDefault();
  next.focus();
}
