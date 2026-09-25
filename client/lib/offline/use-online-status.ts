'use client';

import { useSyncExternalStore } from 'react';

// Pure UI signal — never used to gate the outbox sync path itself (see
// processor.ts's triggerSync docstring for why navigator.onLine is unreliable
// as a *gate*: Chromium/Windows often doesn't fire 'offline' for a Wi-Fi
// radio toggle). Here it only drives what the user is shown (the global
// banner, and Sidebar's choice of hard vs soft navigation) — a stale `true`
// briefly after real connectivity drops just means the banner/behavior
// catches up a beat later, never a correctness issue for data itself.
function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
