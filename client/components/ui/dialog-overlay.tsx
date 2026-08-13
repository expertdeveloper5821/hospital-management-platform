'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface DialogOverlayProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'onClick'> {
  children?:  React.ReactNode;
  /** Extra classes merged onto the backdrop (alignment, bg opacity, padding). */
  className?: string;
  onClick?:   (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * Full-viewport backdrop for dialogs/modals/slide-overs, rendered via a
 * portal directly under <body>.
 *
 * Portaling — rather than rendering inline wherever a page happens to call
 * the modal — is the root-cause fix for backdrops that fail to cover the
 * full viewport (e.g. a gap above the header): the overlay is no longer a
 * descendant of the dashboard layout's header/sidebar/main tree, so it can
 * never be clipped or offset by an ancestor's overflow/stacking context.
 * `fixed inset-0` always resolves against the real viewport, sits above
 * everything in the app via `z-50`, and is unaffected by any page's own
 * scroll container — the page's main scrollbar is untouched.
 *
 * All dialog/modal/slide-over overlays in the app should render through
 * this component instead of a hand-rolled `fixed inset-0` div.
 */
export function DialogOverlay({ children, className, onClick, ...rest }: DialogOverlayProps) {
  // Portals need a browser document; bail out on the server render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className={cn('fixed inset-0 z-50 flex bg-black/50', className)} onClick={onClick} {...rest}>
      {children}
    </div>,
    document.body,
  );
}
