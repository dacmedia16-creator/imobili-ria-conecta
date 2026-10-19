import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAutosave } from "@/components/vendas/shared";
import { validCpf, validCreci } from "@/lib/exclusive-captures-ocr";
import { errorMessage } from "@/lib/errors";
import type { CaptureForm } from "@/lib/exclusive-captures";

type Persist = (form: CaptureForm, cpf: string, creci: string) => Promise<void>;
type Snapshot = { form: CaptureForm; cpf: string; creci: string };
const sameSnapshot = (
  a: Snapshot | null,
  b: { form: CaptureForm | null; cpf: string; creci: string },
) => !!a && a.form === b.form && a.cpf === b.cpf && a.creci === b.creci;

/** CPF/CRECI do captador vazio ou válido (o exclusive_save recusa o save INTEIRO se inválido). */
export function brokerFieldsOk(cpf: string, creci: string): boolean {
  return (!cpf.trim() || validCpf(cpf.trim())) && (!creci.trim() || validCreci(creci));
}

export const AUTOSAVE_BROKER_INVALIDO =
  "CPF ou CRECI do captador inválido: o restante foi salvo. Corrija para salvar esses campos.";

/**
 * Salvamento automático da captação (mesmo useAutosave das Vendas), com as lições da venda:
 * - campo inválido (CPF/CRECI do captador) não derruba o save inteiro: salva o resto com os
 *   últimos valores bons e avisa;
 * - erro de save fica visível até um save dar certo (não só um toast que some);
 * - só zera "dirty" se nada mudou durante o save (digitação no meio do save não se perde e
 *   reagenda um novo save);
 * - preenchimento da IA já grava e deixa dirty=false: não dispara autosave em loop;
 * - "enabled" falso (captação não editável ou ação em andamento) não salva nada.
 */
export function useCaptureAutosave({
  enabled,
  dirty,
  form,
  cpf,
  creci,
  savedCpf,
  savedCreci,
  persist,
  onSaved,
}: {
  enabled: boolean;
  dirty: boolean;
  form: CaptureForm | null;
  cpf: string;
  creci: string;
  /** CPF/CRECI já gravados (usados no lugar do valor inválido digitado). */
  savedCpf: string;
  savedCreci: string;
  persist: Persist;
  /** Tudo o que estava na tela foi gravado: a página marca dirty=false. */
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bloqueio, setBloqueio] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useRef({ form, cpf, creci, dirty });
  latest.current = { form, cpf, creci, dirty };
  const goodBroker = useRef({ cpf: savedCpf, creci: savedCreci });
  useEffect(() => {
    goodBroker.current = { cpf: savedCpf, creci: savedCreci };
  }, [savedCpf, savedCreci]);
  const inFlight = useRef<Promise<unknown> | null>(null);
  // Último conteúdo gravado de fato: o envio não grava de novo o que o autosave acabou de salvar
  // (o "dirty" da tela pode ainda não ter re-renderizado).
  const lastSaved = useRef<Snapshot | null>(null);
  const lastToast = useRef<string | null>(null);
  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

  const doSave = useCallback(async (): Promise<boolean> => {
    const snap = latest.current;
    if (!snap.form || !snap.dirty) return true;
    const ok = brokerFieldsOk(snap.cpf, snap.creci);
    const cpfOut = ok ? snap.cpf : goodBroker.current.cpf;
    const creciOut = ok ? snap.creci : goodBroker.current.creci;
    setSaving(true);
    const p = persist(snap.form, cpfOut, creciOut);
    inFlight.current = p.catch(() => undefined);
    try {
      await p;
      if (ok) lastSaved.current = { form: snap.form, cpf: snap.cpf, creci: snap.creci };
      setError(null);
      lastToast.current = null;
      if (ok) goodBroker.current = { cpf: snap.cpf.trim(), creci: snap.creci.trim() };
      setBloqueio(ok ? null : AUTOSAVE_BROKER_INVALIDO);
      const now = latest.current;
      const unchanged = now.form === snap.form && now.cpf === snap.cpf && now.creci === snap.creci;
      if (unchanged && ok) {
        setSaved(true);
        onSaved();
      } else if (!unchanged) {
        // Editou durante o save: agenda outro (o useAutosave ignora timer com save em andamento).
        setTick((t) => t + 1);
      }
      return ok;
    } catch (e: unknown) {
      const msg = errorMessage(e, "Não foi possível salvar automaticamente");
      setError(msg);
      if (lastToast.current !== msg) toast.error(`Salvamento automático falhou: ${msg}`);
      lastToast.current = msg;
      return false;
    } finally {
      inFlight.current = null;
      setSaving(false);
    }
  }, [persist, onSaved]);

  useAutosave(enabled && dirty, [form, cpf, creci, tick], doSave);

  /**
   * Antes do envio ao gestor: espera o autosave em andamento e grava o que ainda estiver
   * pendente com os valores reais (erro aqui interrompe o envio).
   */
  const flush = useCallback(async () => {
    if (inFlight.current) await inFlight.current;
    const snap = latest.current;
    if (!snap.dirty || !snap.form || sameSnapshot(lastSaved.current, snap)) return;
    await persist(snap.form, snap.cpf, snap.creci);
    lastSaved.current = { form: snap.form, cpf: snap.cpf, creci: snap.creci };
    setError(null);
    setBloqueio(null);
    setSaved(true);
    onSaved();
  }, [persist, onSaved]);

  return { saving, saved, error, bloqueio, flush };
}
