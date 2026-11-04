import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import {
  candidatosContrato,
  escolherCorretorContrato,
  rotuloTestemunha,
  type CandidatoContrato,
  type TestemunhasCaptacao,
} from "@/lib/exclusive-clicksign";
import { TestemunhaDigitadaForm } from "@/components/exclusividades/TestemunhaDigitadaForm";

/**
 * Também usado quando o captador é PROPRIETÁRIO (t_77132312, com ou sem CRECI): as duas testemunhas
 * são digitadas; o bloco "corretor do contrato" só aparece sem CRECI.
 *
 * Captador SEM CRECI (t_e75b58c5): o bloco "corretor" do contrato sai com um gestor/TL com CRECI
 * (padrão: líder da equipe; quem gere pode trocar), o captador assina só como testemunha 1 e a
 * testemunha 2 é digitada aqui. O banco valida tudo de novo. A captação continua do captador.
 */
export function ContratoSemCreci({
  db,
  captureId,
  testemunhas,
  podeTrocar,
  donos = [],
  onChange,
}: {
  db: SupabaseClient;
  captureId: string;
  testemunhas: TestemunhasCaptacao;
  podeTrocar: boolean;
  /** CPFs dos proprietários (parte do contrato não é testemunha, t_77132312). */
  donos?: string[];
  onChange: (t: TestemunhasCaptacao | null) => void;
}) {
  const t = testemunhas;
  const gerir = t.podeGerir && podeTrocar;
  const [lista, setLista] = useState<CandidatoContrato[] | null>(null);
  const [escolha, setEscolha] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLista(null);
    setEscolha("");
  }, [captureId, t.contrato?.id]);
  const acao = async (fn: () => Promise<TestemunhasCaptacao | null>, ok: string, erro: string) => {
    setBusy(true);
    try {
      onChange(await fn());
      toast.success(ok);
      return true;
    } catch (e) {
      toast.error(errorMessage(e, erro));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const abrirLista = async () => {
    try {
      setLista(await candidatosContrato(db, captureId));
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível listar os gestores"));
    }
  };
  const escolher = async (userId: string | null) => {
    if (
      await acao(
        () => escolherCorretorContrato(db, captureId, userId),
        userId
          ? "Corretor do contrato escolhido."
          : "Corretor do contrato voltou para o gestor da equipe.",
        "Não foi possível trocar o corretor do contrato",
      )
    )
      setLista(null);
  };
  const c = t.contrato;
  const prop = !!t.captadorProprietario;
  const semCreci = t.modo === "sem_creci";
  return (
    <div className="space-y-3 text-sm" data-testid="contrato-sem-creci">
      <p
        role="note"
        className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sky-900"
        data-testid={semCreci ? "aviso-sem-creci" : "aviso-captador-proprietario"}
      >
        {semCreci &&
          "O captador não tem CRECI: no contrato, o corretor será um gestor ou team leader com CRECI. "}
        {prop
          ? "O captador também é proprietário deste imóvel: assina como proprietário e não pode ser testemunha, então as duas testemunhas são digitadas."
          : "O captador assina só como testemunha 1."}{" "}
        No sistema a captação continua dele.
      </p>
      {semCreci && (
        <div className="space-y-1 rounded-md border p-3" data-testid="contrato-corretor">
          <p className="font-medium">Corretor no contrato</p>
          <p>
            {c
              ? `${c.nome || "sem nome no cadastro"}${c.creci ? ` · CRECI ${c.creci}` : ""} (${
                  c.origem === "escolhido" ? "escolhido" : "gestor da equipe"
                })${c.ok ? "" : ` — falta ${c.falta.join(", ")}`}`
              : "Não definido"}
          </p>
          {gerir &&
            (lista === null ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void abrirLista()}
                >
                  {c ? "Trocar corretor do contrato" : "Escolher corretor do contrato"}
                </Button>
                {t.contratoEscolhido && t.gestorEquipe && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void escolher(null)}
                  >
                    Voltar para o gestor da equipe ({t.gestorEquipe.nome})
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2 pt-1">
                <div className="space-y-1">
                  <Label htmlFor="contrato-corretor-escolha">Gestor ou team leader com CRECI</Label>
                  <Select value={escolha} onValueChange={setEscolha}>
                    <SelectTrigger id="contrato-corretor-escolha" className="w-72 max-w-full">
                      <SelectValue
                        placeholder={
                          lista.length ? "Escolha" : "Ninguém disponível nesta imobiliária"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {lista.map((p) => (
                        <SelectItem key={p.id} value={p.id} disabled={!p.ok}>
                          {p.nome}
                          {p.creci ? ` · CRECI ${p.creci}` : ""}
                          {p.daEquipe ? " (líder da equipe)" : ""}
                          {p.ok ? "" : ` — falta ${p.falta ?? "cadastro"}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  disabled={busy || !escolha}
                  onClick={() => void escolher(escolha)}
                >
                  Usar no contrato
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setLista(null)}>
                  Cancelar
                </Button>
              </div>
            ))}
        </div>
      )}
      <ul className="space-y-1">
        <li data-testid="testemunha-1">
          {rotuloTestemunha(
            t.corretor,
            prop ? "Testemunha 1 (digitada)" : "Testemunha 1 (captador)",
          )}
        </li>
        <li data-testid="testemunha-2">
          {t.gestor
            ? rotuloTestemunha(t.gestor, "Testemunha 2 (digitada)")
            : "Testemunha 2: não informada"}
        </li>
      </ul>
      {gerir && prop && (
        <TestemunhaDigitadaForm
          db={db}
          captureId={captureId}
          qual={1}
          testemunhas={t}
          donos={donos}
          dica="Não pode ser proprietário do imóvel nem o corretor do contrato. O nome e o CPF saem no PDF (RG em branco)."
          onChange={onChange}
        />
      )}
      {gerir && (
        <TestemunhaDigitadaForm
          db={db}
          captureId={captureId}
          qual={2}
          testemunhas={t}
          donos={donos}
          dica={
            prop
              ? "Não pode ser proprietário, a testemunha 1 nem o corretor do contrato. O nome e o CPF saem no PDF (RG em branco)."
              : "Não pode ser o captador, proprietário nem o corretor do contrato. O nome e o CPF saem no PDF (RG em branco)."
          }
          onChange={onChange}
        />
      )}
      {t.problemas.length > 0 && (
        <ul
          role="status"
          data-testid="testemunhas-aviso"
          className="list-disc rounded-md border border-amber-300 bg-amber-50 py-2 pl-6 pr-3 text-amber-900"
        >
          {t.problemas.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {gerir && t.pdfGerado && (
        <p className="text-xs text-muted-foreground">
          Trocar o corretor do contrato ou uma testemunha digitada exige gerar o PDF para assinatura
          de novo.
        </p>
      )}
    </div>
  );
}
