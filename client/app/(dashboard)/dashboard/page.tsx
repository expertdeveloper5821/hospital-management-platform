import { LayoutDashboard } from 'lucide-react';

export default function DashboardPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
      <LayoutDashboard className="h-12 w-12 opacity-30" />
      <p className="text-lg font-medium">Dashboard</p>
      <p className="text-sm">Select a module from the sidebar to get started.</p>
    </div>
  );
}
