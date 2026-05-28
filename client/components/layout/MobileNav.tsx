'use client';

import { useEffect }     from 'react';
import { Sidebar }       from '@/components/shared/Sidebar';

interface MobileNavProps {
  open:    boolean;
  onClose: () => void;
}

export function MobileNav({ open, onClose }: MobileNavProps) {
  // Lock body scroll while drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* Backdrop — only on mobile (hidden md+, because Sidebar is static there) */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Slide-in drawer */}
      <div
        role="dialog"
        aria-label="Navigation menu"
        aria-modal="true"
        aria-hidden={!open}
        className={`fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out md:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onClose={onClose} />
      </div>
    </>
  );
}
