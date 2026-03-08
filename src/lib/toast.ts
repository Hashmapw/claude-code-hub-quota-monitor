type ToastType = 'success' | 'error' | 'info' | 'warning';

export type ToastData = {
  id: string;
  title?: string;
  description?: string;
  type: ToastType;
  duration?: number;
};

type ToastListener = (toast: ToastData) => void;

let listeners: ToastListener[] = [];

export const toast = {
  success: (title: string, description?: string, duration?: number) => emit('success', title, description, duration),
  error: (title: string, description?: string, duration?: number) => emit('error', title, description, duration),
  info: (title: string, description?: string, duration?: number) => emit('info', title, description, duration),
  warning: (title: string, description?: string, duration?: number) => emit('warning', title, description, duration),
  subscribe: (listener: ToastListener) => {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  },
};

function emit(type: ToastType, title: string, description?: string, duration?: number) {
  const id = Math.random().toString(36).substring(2, 9);
  const data: ToastData = { id, title, description, type, duration };
  listeners.forEach((l) => l(data));
}
