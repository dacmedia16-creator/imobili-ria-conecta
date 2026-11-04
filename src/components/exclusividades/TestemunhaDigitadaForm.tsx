import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import {
  salvarTestemunhaManual,
  testemunhaManualErros,
  type TestemunhaManual,
  type TestemunhasCaptacao,
} from "@/lib/exclusive-clicksign";

const VAZIO: TestemunhaManual = { nome: "", cpf: "", email: "" };

/**
 * Formulário de UMA testemunha digitada (1 ou 2). Usado no captador sem CRECI (testemunha 2) e no
 * captador que também é proprietário (testemunhas 1 e 2, t_77132312). O banco valida tudo de novo.
 */
export function TestemunhaDigitadaForm({
  db,
  captureId,
  qual,
  testemunhas,
  donos,
  dica,
  onChange,
}: {
  db: SupabaseClient;
  captureId: string;
  qual: 1 | 2;
  testemunhas: TestemunhasCaptacao;
  /** CPFs dos proprietários (parte do contrato não é testemunha). */
  donos: string[];
  dica: string;
  onChange: (t: TestemunhasCaptacao | null) => void;
}) {
  const t = testemunhas;
  const gravado = (qual === 1 ? t.manual1 : t.manual) ?? null;
  const [m, setM] = useState<TestemunhaManual>(gravado ?? VAZIO);
  const [tocado, setTocado] = useState(false);
  const [busy, setBusy] = useState(false);
  // Recarrega só quando o valor gravado muda (não a cada novo objeto da resposta).
  const salvo = JSON.stringify(gravado);
  useEffect(() => {
    setM((JSON.parse(salvo) as TestemunhaManual | null) ?? VAZIO);
    setTocado(false);
  }, [captureId, salvo]);

  const erros = testemunhaManualErros(m, t, { qual, donos });
  const mudou =
    m.nome !== (gravado?.nome ?? "") ||
    m.cpf !== (gravado?.cpf ?? "") ||
    m.email !== (gravado?.email ?? "");

  return (
    <form
      className="grid gap-2 rounded-md border p-3 sm:grid-cols-3"
      data-testid={`testemunha-${qual}-manual`}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTocado(true);
        if (erros.length) return;
        setBusy(true);
        salvarTestemunhaManual(db, captureId, qual, m)
          .then((r) => {
            onChange(r);
            toast.success(`Testemunha ${qual} salva.`);
          })
          .catch((err) =>
            toast.error(errorMessage(err, `Não foi possível salvar a testemunha ${qual}`)),
          )
          .finally(() => setBusy(false));
      }}
    >
      <p className="font-medium sm:col-span-3">Testemunha {qual} (digite)</p>
      {(
        [
          ["nome", "Nome completo", "text"],
          ["cpf", "CPF", "text"],
          ["email", "E-mail (recebe o link da Clicksign)", "email"],
        ] as const
      ).map(([k, label, type]) => (
        <div key={k} className="space-y-1">
          <Label htmlFor={`t${qual}-${k}`}>{label}</Label>
          <Input
            id={`t${qual}-${k}`}
            type={type}
            inputMode={k === "cpf" ? "numeric" : undefined}
            maxLength={k === "email" ? 254 : k === "cpf" ? 14 : 200}
            value={m[k]}
            disabled={busy}
            onChange={(e) => setM((cur) => ({ ...cur, [k]: e.target.value }))}
          />
        </div>
      ))}
      {tocado && erros.length > 0 && (
        <p role="alert" className="text-amber-900 sm:col-span-3">
          Falta: {erros.join(", ")}.
        </p>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-3">
        <Button type="submit" size="sm" disabled={busy || !mudou}>
          Salvar testemunha {qual}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-3">{dica}</p>
    </form>
  );
}
