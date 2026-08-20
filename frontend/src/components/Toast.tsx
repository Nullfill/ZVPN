import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertCircle, XCircle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';
type ToastItem = { id: number; message: string; type: ToastType };

const ToastCtx = createContext<(msg: string, type?: ToastType) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Record<number, number>>({});

  useEffect(() => () => {
    Object.values(timers.current).forEach((id) => window.clearTimeout(id));
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.round(Math.random() * 1000);
    setToasts((items) => [...items, { id, message, type }]);
    timers.current[id] = window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
      delete timers.current[id];
    }, 4000);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="fixed bottom-6 left-6 z-[100] flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="glass flex items-center gap-3 px-4 py-3 text-sm"
            >
              {t.type === 'success' && <CheckCircle className="text-emerald-400" size={18} />}
              {t.type === 'error' && <XCircle className="text-rose-400" size={18} />}
              {t.type === 'info' && <AlertCircle className="text-sky-400" size={18} />}
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
