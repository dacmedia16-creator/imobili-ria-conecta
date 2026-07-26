import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export type Saver = () => Promise<boolean>;

const AUTOSAVE_DELAY_MS = 1200;

// Salva sozinho X ms depois da última alteração, sem precisar de clique em "Salvar".
// O delay evita gravar valor pela metade enquanto a pessoa ainda está digitando, e o
// savingRef evita disparar um novo save por cima de um que ainda não terminou.
export function useAutosave(dirty: boolean, deps: readonly unknown[], saveFn: () => Promise<boolean>) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      try { await saveFn(); } finally { savingRef.current = false; }
    }, AUTOSAVE_DELAY_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, ...deps]);
}

export function AutosaveStatus({ saving, dirty }: { saving: boolean; dirty: boolean }) {
  if (saving) return <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Salvando...</div>;
  if (dirty) return <div className="text-xs text-muted-foreground">Alterações pendentes — salvando em instantes...</div>;
  return null;
}

export function SaleSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>;
}
export function Field({ label, children, colSpan }: { label: string; children: React.ReactNode; colSpan?: number }) {
  return (
    <div className={colSpan === 2 ? "md:col-span-2" : ""}>
      <Label className="mb-1.5 block text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Campo de valor em reais: digita-se em centavos (estilo maquininha) e formata como "R$ 1.234,56". */
export function CurrencyInput({ value, onChange, disabled }: { value: number | null | undefined; onChange: (v: number | null) => void; disabled?: boolean }) {
  const [display, setDisplay] = useState(() => (value != null ? brl(Math.round(value * 100)) : ""));

  useEffect(() => {
    setDisplay(value != null ? brl(Math.round(value * 100)) : "");
  }, [value]);

  return (
    <Input
      inputMode="decimal"
      placeholder="R$ 0,00"
      disabled={disabled}
      value={display}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        if (!digits) { setDisplay(""); onChange(null); return; }
        const cents = parseInt(digits, 10);
        setDisplay(brl(cents));
        onChange(cents / 100);
      }}
    />
  );
}

export const money = (v: any) => (v != null ? `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : null);
export const dateBR = (v: any) => (v ? new Date(v).toLocaleDateString("pt-BR") : null);

export function DocStatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    pendente: "bg-muted text-muted-foreground",
    enviado: "bg-blue-100 text-blue-900",
    aprovado: "bg-emerald-100 text-emerald-900",
    recusado: "bg-destructive/15 text-destructive",
  };
  const label: Record<string, string> = { pendente: "Pendente", enviado: "Enviado", aprovado: "Aprovado", recusado: "Recusado" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone[status]}`}>{label[status]}</span>;
}
