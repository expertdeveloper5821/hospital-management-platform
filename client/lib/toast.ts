export type ToastVariant = 'success' | 'error';

export interface ToastPayload {
  id?: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}

export const TOAST_EVENT = 'hms:toast';

export function emitToast(payload: ToastPayload) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }));
}

export function toastSuccess(title: string, description?: string) {
  emitToast({ variant: 'success', title, description });
}

export function toastError(title: string, description?: string) {
  emitToast({ variant: 'error', title, description });
}
