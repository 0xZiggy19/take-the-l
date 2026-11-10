import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { EXPLORER } from "../config";

interface Toast { id: number; kind: "ok" | "err"; text: string; hash?: string }
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 9000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} data-testid={`toast-${t.kind}`}>
            <span>{t.text}</span>
            {t.hash && (
              <a href={`${EXPLORER}/txns/${t.hash}`} target="_blank" rel="noreferrer">view tx ↗</a>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
