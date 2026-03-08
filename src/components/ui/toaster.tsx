"use client";

import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast, type ToastData } from '@/lib/toast';
import { cn } from '@/lib/utils';

function Icon({ type }: { type: ToastData['type'] }) {
  if (type === 'success') return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (type === 'error') return <AlertCircle className="h-5 w-5 text-rose-500" />;
  if (type === 'warning') return <AlertCircle className="h-5 w-5 text-amber-500" />;
  return <Info className="h-5 w-5 text-blue-500" />;
}

export function Toaster() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  useEffect(() => {
    return toast.subscribe((newToast) => {
      setToasts((current) => [...current, newToast]);
      if (newToast.duration === 0) {
        return;
      }
      setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== newToast.id));
      }, newToast.duration ?? 4000);
    });
  }, []);

  const removeToast = (id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  };

  return (
    <div
      className="fixed right-6 z-[120] flex w-full max-w-[380px] flex-col gap-4 outline-none"
      style={{ bottom: 'calc(1.5rem + var(--toast-bottom-offset, 0px))' }}
    >
      {toasts.map((t) => {
        const isError = t.type === 'error';
        const isSuccess = t.type === 'success';
        const isWarning = t.type === 'warning';
        
        return (
          <div
            key={t.id}
            className={cn(
              "group pointer-events-auto relative flex w-full gap-4 overflow-hidden rounded-[1.25rem] border border-border/40 bg-background/95 p-5 shadow-2xl backdrop-blur-xl transition-all hover:shadow-primary/5 dark:bg-zinc-950/95",
              "animate-in slide-in-from-right-full fade-in duration-500",
              "hover:border-foreground/10",
              t.description ? "items-start" : "items-center"
            )}
            role="alert"
          >
            {/* Accent side bar */}
            <div className={cn(
              "absolute left-0 top-0 bottom-0 w-1.5",
              isSuccess && "bg-emerald-500",
              isError && "bg-rose-500",
              isWarning && "bg-amber-500",
              !isSuccess && !isError && !isWarning && "bg-blue-500"
            )} />

            <div className="flex shrink-0">
              <Icon type={t.type} />
            </div>
            
            <div className={cn("flex-1 pr-4", t.description ? "space-y-1.5" : "flex items-center")}>
              {t.title && (
                <div className={cn(
                  "text-sm font-black tracking-tight text-foreground uppercase italic leading-none",
                  t.description && "pt-0.5"
                )}>
                  {t.title}
                </div>
              )}
              {t.description && (
                <div className="text-[13px] font-medium text-muted-foreground leading-relaxed">
                  {t.description}
                </div>
              )}
            </div>

            <button
              onClick={() => removeToast(t.id)}
              className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg bg-muted/0 text-muted-foreground/40 transition-all hover:bg-muted hover:text-foreground active:scale-90"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
