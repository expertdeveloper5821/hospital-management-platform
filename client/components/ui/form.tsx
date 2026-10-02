'use client';

import * as React from 'react';
import { autoFocusFirstFieldRef, handleEnterNavigation } from '@/lib/form-navigation';

export interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  /**
   * Focus the first field when the form mounts (default true). Turn off for
   * secondary forms embedded further down a page, which don't "open" and
   * would otherwise scroll the page to themselves on load.
   */
  autoFocusFirstField?: boolean;
}

/**
 * Drop-in replacement for <form> with the app's standard keyboard behaviour:
 * the first field is focused when the form opens, and Enter moves to the next
 * field instead of submitting early (see lib/form-navigation.ts). Enter on the
 * last field, and every submit button, behave exactly like a plain <form>.
 */
export function NavForm({ autoFocusFirstField = true, onKeyDown, ...props }: FormProps) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    onKeyDown?.(e);
    handleEnterNavigation(e);
  }

  return (
    <form
      ref={autoFocusFirstField ? autoFocusFirstFieldRef : undefined}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
}
