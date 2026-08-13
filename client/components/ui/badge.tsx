import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:     'bg-primary text-primary-foreground',
        secondary:   'bg-secondary text-secondary-foreground',
        destructive: 'bg-destructive/15 text-destructive',
        outline:     'border border-input text-foreground',
        // Fixed semantic statuses — never tenant-brand-colored. Use these
        // (not `default`) for Active/Pending/Completed/etc. status badges.
        success:     'bg-success/15 text-success',
        warning:     'bg-warning/15 text-warning',
        info:        'bg-info/15 text-info',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
