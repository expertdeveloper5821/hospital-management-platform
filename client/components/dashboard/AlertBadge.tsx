import type { LucideIcon } from 'lucide-react';

interface AlertBadgeProps {
  icon:    LucideIcon;
  label:   string;
  count:   number;
  /** When true the badge renders in warning colours */
  warn?:   boolean;
}

export function AlertBadge({ icon: Icon, label, count, warn }: AlertBadgeProps) {
  const hasAlert = warn && count > 0;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium border ${
        hasAlert
          ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-300'
          : 'bg-muted border-transparent text-muted-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
      <span
        className={`ml-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold ${
          hasAlert ? 'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-100' : 'bg-muted-foreground/20'
        }`}
      >
        {count}
      </span>
    </div>
  );
}
