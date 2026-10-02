import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavForm } from '@/components/ui/form';
import { DialogOverlay } from '@/components/ui/dialog-overlay';

function BasicForm({ onSubmit = jest.fn(), autoFocusFirstField }: { onSubmit?: jest.Mock; autoFocusFirstField?: boolean }) {
  return (
    <NavForm
      autoFocusFirstField={autoFocusFirstField}
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
    >
      <input type="hidden" name="h" />
      <input aria-label="readonly" readOnly />
      <input aria-label="disabled" disabled />
      <input aria-label="first" />
      <input aria-label="date" type="date" />
      <select aria-label="choice"><option value="a">A</option></select>
      <textarea aria-label="notes" />
      <input aria-label="file" type="file" />
      <details>
        <summary>More</summary>
        <input aria-label="collapsed" />
      </details>
      <input aria-label="last" />
      <button type="submit">Save</button>
    </NavForm>
  );
}

describe('NavForm — focus on open', () => {
  it('focuses the first fillable field, skipping hidden, read-only and disabled inputs', () => {
    render(<BasicForm />);
    expect(screen.getByLabelText('first')).toHaveFocus();
  });

  it('keeps a field’s own autoFocus instead of overriding it', () => {
    render(
      <NavForm>
        <input aria-label="a" />
        <input aria-label="b" autoFocus />
      </NavForm>,
    );
    expect(screen.getByLabelText('b')).toHaveFocus();
  });

  it('does not focus anything when autoFocusFirstField is false', () => {
    render(<BasicForm autoFocusFirstField={false} />);
    expect(document.body).toHaveFocus();
  });

  it('a page form does not steal focus from a field the user is already in', async () => {
    function Page() {
      const [show, setShow] = useState(false);
      return (
        <>
          <input aria-label="outside" onChange={() => setShow(true)} />
          {show && <NavForm><input aria-label="inner" /></NavForm>}
        </>
      );
    }
    render(<Page />);
    const outside = screen.getByLabelText('outside');
    await userEvent.type(outside, 'x');
    expect(screen.getByLabelText('inner')).toBeInTheDocument();
    expect(outside).toHaveFocus();
  });

  it('a form inside a dialog takes focus when it opens', async () => {
    function Page() {
      const [show, setShow] = useState(false);
      return (
        <>
          <input aria-label="outside" onChange={() => setShow(true)} />
          {show && (
            <DialogOverlay>
              <NavForm><input aria-label="dialog field" /></NavForm>
            </DialogOverlay>
          )}
        </>
      );
    }
    render(<Page />);
    await userEvent.type(screen.getByLabelText('outside'), 'x');
    await waitFor(() => expect(screen.getByLabelText('dialog field')).toHaveFocus());
  });
});

describe('NavForm — Enter moves to the next field', () => {
  it('walks the fields in order without submitting, then submits from the last field', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<BasicForm onSubmit={onSubmit} />);

    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('date')).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('choice')).toHaveFocus();

    // <select>: Enter is not cancelled (so an open dropdown can commit) and
    // focus moves right after.
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByLabelText('notes')).toHaveFocus());
    expect(onSubmit).not.toHaveBeenCalled();

    // Textarea: Enter is a newline, focus stays put.
    await user.keyboard('line{Enter}two');
    expect(screen.getByLabelText('notes')).toHaveFocus();
    expect(screen.getByLabelText('notes')).toHaveValue('line\ntwo');

    // Last field keeps native implicit submission.
    await user.click(screen.getByLabelText('last'));
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('skips fields inside a collapsed <details> but includes them when it is open', async () => {
    const user = userEvent.setup();
    render(
      <NavForm>
        <input aria-label="a" />
        <details>
          <summary>More</summary>
          <input aria-label="b" />
        </details>
        <input aria-label="c" />
      </NavForm>,
    );
    const a = screen.getByLabelText('a');
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('c')).toHaveFocus();

    (screen.getByText('More').parentElement as HTMLDetailsElement).open = true;
    a.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('b')).toHaveFocus();
  });

  it('leaves Enter alone when a field already handled it', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(
      <NavForm onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <input aria-label="picker" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
        <input aria-label="next" />
        <button type="submit">Save</button>
      </NavForm>,
    );
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('picker')).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit a form whose submit button is disabled when Enter is pressed on the last field', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(
      <NavForm onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <input aria-label="only" />
        <button type="submit" disabled>Save</button>
      </NavForm>,
    );
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('ignores Enter from a nested dialog form rendered through a portal', async () => {
    const user = userEvent.setup();
    const outerSubmit = jest.fn();
    render(
      <NavForm onSubmit={(e) => { e.preventDefault(); outerSubmit(); }}>
        <input aria-label="outer a" />
        <input aria-label="outer b" />
        <DialogOverlay>
          <NavForm>
            <input aria-label="inner a" />
            <input aria-label="inner b" />
          </NavForm>
        </DialogOverlay>
      </NavForm>,
    );
    const innerA = await screen.findByLabelText('inner a');
    innerA.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('inner b')).toHaveFocus();
    expect(outerSubmit).not.toHaveBeenCalled();
  });
});
