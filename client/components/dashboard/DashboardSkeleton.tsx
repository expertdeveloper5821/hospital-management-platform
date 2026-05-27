import { StatCard } from './StatCard';
import {
  Users, CalendarDays, BedDouble, FlaskConical,
  IndianRupee, PackageX, UserCheck,
} from 'lucide-react';

export function DashboardSkeleton() {
  const skeletonCards = [
    Users, CalendarDays, BedDouble, FlaskConical,
    IndianRupee, IndianRupee, PackageX, UserCheck,
  ];

  return (
    <div className="space-y-6">
      {/* Stat card grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {skeletonCards.map((Icon, i) => (
          <StatCard
            key={i}
            icon={Icon}
            label=""
            value=""
            skeleton
          />
        ))}
      </div>

      {/* Chart skeleton row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-5 animate-pulse">
            <div className="h-4 w-40 rounded bg-muted mb-4" />
            <div className="h-40 w-full rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
