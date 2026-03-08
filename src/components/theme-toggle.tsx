'use client';

import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-muted">
        <div className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-muted relative">
          <Sun className="h-[1.1rem] w-[1.1rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-amber-500" />
          <Moon className="absolute h-[1.1rem] w-[1.1rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-indigo-400" />
          <span className="sr-only">切换主题</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-2xl border-border/40 bg-background/95 backdrop-blur-xl shadow-xl p-1.5 min-w-[120px]">
        <DropdownMenuItem onClick={() => setTheme('light')} className={`rounded-xl cursor-pointer font-bold text-xs py-2 px-3 focus:bg-muted/50 transition-colors ${theme === 'light' ? 'bg-primary/10 text-primary focus:bg-primary/15' : 'text-muted-foreground focus:text-foreground'}`}>
          <Sun className="mr-2 h-4 w-4" />
          <span>浅色</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')} className={`rounded-xl cursor-pointer font-bold text-xs py-2 px-3 focus:bg-muted/50 transition-colors ${theme === 'dark' ? 'bg-primary/10 text-primary focus:bg-primary/15' : 'text-muted-foreground focus:text-foreground'}`}>
          <Moon className="mr-2 h-4 w-4" />
          <span>深色</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')} className={`rounded-xl cursor-pointer font-bold text-xs py-2 px-3 focus:bg-muted/50 transition-colors ${theme === 'system' ? 'bg-primary/10 text-primary focus:bg-primary/15' : 'text-muted-foreground focus:text-foreground'}`}>
          <Monitor className="mr-2 h-4 w-4" />
          <span>跟随系统</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
