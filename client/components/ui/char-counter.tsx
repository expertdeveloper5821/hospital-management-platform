interface CharCounterProps {
  value: string;
  max: number;
  /** Whether the stored value is trimmed before validation/submission (default true). */
  trimmed?: boolean;
  className?: string;
}

// Shared live character counter for textarea/text fields with a max length.
export function CharCounter({ value, max, trimmed = true, className = '' }: CharCounterProps) {
  const length = trimmed ? value.trim().length : value.length;
  const over = length > max;
  return (
    <p className={`text-xs text-right ${over ? 'text-destructive' : 'text-muted-foreground'} ${className}`}>
      {length} / {max} characters
    </p>
  );
}
