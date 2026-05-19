'use client';

import { useEffect } from 'react';
import { useAppSelector } from '@/store/hooks';

/**
 * Applies tenant branding to CSS custom properties on the document root.
 * primaryColor from backend is a hex string (e.g. "#1A73E8").
 * Converts it to HSL for Tailwind's hsl(var(--primary)) pattern.
 */
function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const branding = useAppSelector((s) => s.auth.branding);

  useEffect(() => {
    if (!branding) return;

    const root = document.documentElement;

    // Apply tenant primary colour to CSS custom properties used by Tailwind
    if (branding.primaryColor?.startsWith('#')) {
      const hsl = hexToHsl(branding.primaryColor);
      root.style.setProperty('--primary',      hsl);
      root.style.setProperty('--ring',         hsl);
      root.style.setProperty('--tenant-primary', hsl);
    }
  }, [branding]);

  return <>{children}</>;
}
