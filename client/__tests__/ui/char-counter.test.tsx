import React from 'react';
import { render, screen } from '@testing-library/react';
import { CharCounter } from '@/components/ui/char-counter';

describe('CharCounter', () => {
  test('renders current length and max', () => {
    render(<CharCounter value="hello" max={500} />);
    expect(screen.getByText('5 / 500 characters')).toBeInTheDocument();
  });

  test('updates live as value changes (rerender)', () => {
    const { rerender } = render(<CharCounter value="hi" max={10} />);
    expect(screen.getByText('2 / 10 characters')).toBeInTheDocument();

    rerender(<CharCounter value="hello!" max={10} />);
    expect(screen.getByText('6 / 10 characters')).toBeInTheDocument();
  });

  test('counts trimmed length by default, ignoring trailing whitespace', () => {
    render(<CharCounter value="  hello  " max={500} />);
    expect(screen.getByText('5 / 500 characters')).toBeInTheDocument();
  });

  test('counts raw length when trimmed=false', () => {
    render(<CharCounter value="  hello  " max={500} trimmed={false} />);
    expect(screen.getByText('9 / 500 characters')).toBeInTheDocument();
  });

  test('applies error styling when over the limit', () => {
    render(<CharCounter value={'a'.repeat(10)} max={5} />);
    const el = screen.getByText('10 / 5 characters');
    expect(el.className).toContain('text-destructive');
  });

  test('does not apply error styling when within the limit', () => {
    render(<CharCounter value="ok" max={5} />);
    const el = screen.getByText('2 / 5 characters');
    expect(el.className).toContain('text-muted-foreground');
    expect(el.className).not.toContain('text-destructive');
  });
});
