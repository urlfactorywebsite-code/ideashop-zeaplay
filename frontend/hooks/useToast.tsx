import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type ToastTone = 'success' | 'error' | 'info';

interface ToastState {
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<ToastState | null>(null);
  const durationRef = useRef<number | null>(null);

  const notify = useCallback((message: string, tone: ToastTone = 'success', duration = 3200) => {
    setToast({ message, tone });
    if (durationRef.current) {
      window.clearTimeout(durationRef.current);
    }
    durationRef.current = window.setTimeout(() => {
      setToast(null);
    }, duration);
  }, []);

  useEffect(() => {
    return () => {
      if (durationRef.current) {
        window.clearTimeout(durationRef.current);
      }
    };
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div
            className={`max-w-sm rounded-2xl border px-4 py-3 text-sm font-medium shadow-2xl transition ${
              toast.tone === 'error'
                ? 'bg-rose-500/10 border-rose-400/70 text-rose-200'
                : toast.tone === 'info'
                  ? 'bg-sky-500/10 border-sky-400/70 text-sky-200'
                  : 'bg-emerald-500/10 border-emerald-400/70 text-emerald-200'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside a ToastProvider');
  }
  return context;
};
