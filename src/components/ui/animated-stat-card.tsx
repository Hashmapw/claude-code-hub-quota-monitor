import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type AnimatedStatCardProps = {
  title: string;
  value: ReactNode;
  icon: LucideIcon;
  glowClassName: string;
  iconClassName: string;
  iconWrapClassName: string;
  valueClassName?: string;
  className?: string;
};

export function AnimatedStatCard({
  title,
  value,
  icon: Icon,
  glowClassName,
  iconClassName,
  iconWrapClassName,
  valueClassName,
  className,
}: AnimatedStatCardProps) {
  return (
    <div className={cn(
      "group relative flex h-full min-h-[140px] flex-col justify-between overflow-hidden rounded-2xl border border-border/50 bg-card/60 p-5 shadow-sm backdrop-blur-lg transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md dark:border-white/[0.08] dark:bg-[rgba(20,20,23,0.5)] md:p-6",
      "before:pointer-events-none before:absolute before:inset-0 before:z-[1] before:bg-gradient-to-b before:from-white/[0.02] before:to-transparent",
      className
    )}>
      <div className={cn(
        'pointer-events-none absolute -right-[15%] -top-[30%] z-0 h-[150px] w-[150px] rounded-full blur-[50px] opacity-40 transition-opacity duration-500 group-hover:opacity-60',
        glowClassName
      )} />

      <div className="relative z-10 flex flex-col h-full justify-between">
        <div>
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <div className={cn(
                'flex-shrink-0 rounded-xl p-2.5 transition-all duration-300 group-hover:scale-105 shadow-sm',
                iconWrapClassName
              )}>
                <Icon className={cn('h-4 w-4', iconClassName)} />
              </div>
              <p className="truncate text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground/80">{title}</p>
            </div>
          </div>

          <div className="mt-4">
            <h3 className={cn(
              'text-2xl font-bold tracking-tight text-foreground transition-all duration-300 md:text-3xl lg:text-4xl',
              valueClassName
            )}>
              {value}
            </h3>
          </div>
        </div>
        
        {/* Subtle decorative element at the bottom */}
        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-muted/30">
          <div className={cn("h-full w-1/3 rounded-full opacity-50 transition-all duration-500 group-hover:w-full", iconWrapClassName)} />
        </div>
      </div>
    </div>
  );
}
