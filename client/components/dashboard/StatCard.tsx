import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  icon:      LucideIcon;
  label:     string;
  value:     number | string;
  context?:  string;
  skeleton?: boolean;
}

export function StatCard({ icon: Icon, label, value, context, skeleton }: StatCardProps) {
  if (skeleton) {
    return (
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-3 animate-pulse">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded bg-muted" />
          <div className="h-4 w-28 rounded bg-muted" />
        </div>
        <div className="h-8 w-20 rounded bg-muted" />
        <div className="h-3 w-36 rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-5 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
        <Icon className="h-4 w-4 shrink-0" />
        <span>{label}</span>
      </div>
      <p className="text-3xl font-bold tracking-tight text-foreground">
        {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
      </p>
      {context && (
        <p className="text-xs text-muted-foreground">{context}</p>
      )}
    </div>
  );
}
