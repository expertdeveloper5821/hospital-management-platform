# Frontend Shared Infrastructure Plan

**Scope**: HMS client — platform-wide shared infrastructure  
**Stage**: Post-construction enhancements  
**Status**: COMPLETE  
**Branch**: `toastify`  
**Date**: 2026-05-25

---

## Overview

This plan documents shared frontend infrastructure that spans all U7 subunits. These pieces are not tied to a single functional component but are consumed globally across the client application.

---

## Toast Notification System

### Problem
Individual API mutations had no user feedback on success or failure beyond in-page error banners. There was no consistent, non-blocking notification pattern.

### Solution
A lightweight custom event-bus toast system — no third-party library dependency.

### Files

**`client/lib/toast.ts`** — event-bus utility:
- `ToastVariant`: `'success' | 'error'`
- `ToastPayload`: `{ id?, variant, title, description? }`
- `TOAST_EVENT = 'hms:toast'` — custom window event name
- `emitToast(payload)` — dispatches `CustomEvent` on `window`; SSR-safe (guards `typeof window`)
- `toastSuccess(title, description?)` — shorthand helper
- `toastError(title, description?)` — shorthand helper

**`client/components/shared/Toaster.tsx`** — global renderer:
- `useEffect` registers/unregisters `hms:toast` listener on mount
- Stacks up to 4 toasts, newest first; auto-dismisses each after 4000 ms
- Success: emerald border + `CheckCircle2` icon; Error: destructive border + `XCircle` icon
- Manual dismiss (×) button per toast
- `aria-live="polite"` for screen-reader accessibility
- Positioned fixed top-right (`z-50`)

**`client/app/layout.tsx`** — mount point:
- `<Toaster />` added inside `<ReduxProvider>`, after `<AuthHydrator />`
- Renders globally for all pages

---

## RTK Query Base Layer — Auto-Toast Integration

**`client/store/api/base.api.ts`** — `baseQueryWithToasts` wrapper:

Wraps `fetchBaseQuery` to fire toasts automatically for every RTK Query mutation. Queries (GETs) are never toasted.

**On mutation error**: `toastError('Request failed', extractedMessage)` — message extracted from `data.message`, `data.error`, or falls back to `'Something went wrong. Please try again.'`

**On mutation success**: looks up `endpointSuccessMessages` map, then falls back to `data.message` from response body, then `'Saved successfully.'`

**`endpointSuccessMessages` map** (hard-coded per endpoint name):
| Endpoint key | Message |
|---|---|
| `login` | Signed in successfully. |
| `superAdminLogin` | Signed in successfully. |
| `changePassword` | Password updated successfully. |
| `forgotPassword` | Password reset link sent. |
| `resetPassword` | Password reset successfully. |
| `completeSetup` | Setup completed successfully. |
| `logout` | Signed out successfully. |

**`quietSuccessEndpoints` Set** — mutations that do NOT show a success toast:
- `createRazorpayOrder`
- `markNotificationRead`

---

## Form Validation Pattern (standardised across all forms)

A consistent client-side validation pattern was established across U7-B and U7-C forms and should be followed by all future forms:

```
// 1. Pure validate function — derives errors from form state, no setState
function validateForm(form: FormState): Partial<Record<keyof FormState, string>> { ... }

// 2. State
const [touched,   setTouched]   = useState<Partial<Record<keyof FormState, boolean>>>({});
const [submitted, setSubmitted] = useState(false);
const [apiError,  setApiError]  = useState('');

// 3. Derived
const errors    = validateForm(form);
const hasErrors = Object.keys(errors).length > 0;

// 4. Helpers
function touch(field) { setTouched(t => ({ ...t, [field]: true })); }
function fe(field)    { return (submitted || touched[field]) ? errors[field] : undefined; }

// 5. Submit gate
function handleSubmit(e) {
  e.preventDefault();
  setSubmitted(true);
  if (hasErrors) return;
  // ... API call
}
```

**Rules**:
- `noValidate` on `<form>` always — suppress browser native popups
- Errors show on blur per field (`onBlur={() => touch('field')}`)
- All errors surface on first submit attempt (`submitted` flag)
- API errors go in `apiError` state, never mixed with field-level errors
- Error border: `border-destructive focus-visible:ring-destructive` on `<Input>`

---

## How to Apply

- **New mutations**: auto-toasting is handled by `base.api.ts`. Add an entry to `endpointSuccessMessages` for custom wording; add to `quietSuccessEndpoints` to suppress.
- **Manual toasts** (non-API actions): call `toastSuccess` / `toastError` from `@/lib/toast` directly.
- **New forms**: follow the validation pattern above — pure `validateForm` function, `touched` + `submitted` states, `fieldError()` helper.
- Do NOT add toast calls inside individual API slice files — the base layer handles it globally.
