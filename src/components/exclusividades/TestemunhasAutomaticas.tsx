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
  avisoSemGestor,
  candidatosTestemunha,
  escolherTestemunhaGestor,
  rotuloTestemunha,
  type CandidatoTestemunha,
  type TestemunhasCaptacao,
} from "@/lib/exclusive-clicksign";

/**
 * Testemunhas automáticas da captação (t_e8078685): 1 = corretor, 2 = gestor da equipe dele.
 * Mostra quem é, o que falta no cadastro e, para quem gere a captação, permite escolher outro gestor
 * ou team leader da MESMA imobiliária (o banco confere de novo). Sem e-mail nem CPF na tela.
 */
export function TestemunhasAutomaticas({
  db,
  captureId,
  testemunhas,
  podeTrocar,
  onChange,
}: {
  db: SupabaseClient;
  captureId: string;
  testemunhas: TestemunhasCaptacao;
  /** Captação ainda antes da assinatura (rascunho, devolvida ou enviada) e sem envelope ativo. */
  podeTrocar: boolean;
  onChange: (t: TestemunhasCaptacao | null) => void;
}) {
  const t = testemunhas;
  const [lista, setLista] = useState<CandidatoTestemunha[] | null>(null);
  const [escolha, setEscolha] = useState("");
  const [busy, setBusy] = useState(false);
  const gerir = t.podeGerir && podeTrocar;

  useEffect(() => {
    setLista(null);
    setEscolha("");
  }, [captureId, t.gestor?.id]);

  const abrirLista = async () => {
    try {
      setLista(await candidatosTestemunha(db, captureId));
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível listar os gestores"));
    }
  };
  const salvar = async (userId: string | null) => {
    setBusy(true);
    try {
      onChange(await escolherTestemunhaGestor(db, captureId, userId));
      toast.success(
        userId ? "Testemunha 2 escolhida." : "Testemunha 2 voltou para o gestor da equipe.",
      );
      setLista(null);
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível trocar a testemunha"));
    } finally {
      setBusy(false);
    }
  };

  const semGestor = avisoSemGestor(t);
  return (
    <div className="space-y-2 text-sm" data-testid="testemunhas-automaticas">
      <ul className="space-y-1">
        <li data-testid="testemunha-1">
          {rotuloTestemunha(t.corretor, "Testemunha 1 (corretor da captação)")}
        </li>
        <li data-testid="testemunha-2">
          {t.gestor
            ? rotuloTestemunha(
                t.gestor,
                t.gestor.origem === "escolhido"
                  ? "Testemunha 2 (escolhida)"
                  : "Testemunha 2 (gestor da equipe)",
              )
            : "Testemunha 2: não definida"}
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">
        Elas assinam pela Clicksign com o e-mail do cadastro, e o PDF sai com o nome e o CPF delas
        (o campo RG fica em branco). O corretor assina só como testemunha.
      </p>
      {(semGestor || t.problemas.length > 0) && (
        <ul
          role="status"
          data-testid="testemunhas-aviso"
          className="list-disc rounded-md border border-amber-300 bg-amber-50 py-2 pl-6 pr-3 text-amber-900"
        >
          {semGestor && !t.problemas.includes(semGestor) && <li>{semGestor}</li>}
          {t.problemas.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {gerir && (
        <div className="space-y-2">
          {lista === null ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void abrirLista()}>
                {t.gestor ? "Trocar testemunha 2" : "Escolher testemunha 2"}
              </Button>
              {t.escolhido && t.gestorEquipe && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void salvar(null)}>
                  Voltar para o gestor da equipe ({t.gestorEquipe.nome})
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="testemunha-2-escolha">
                  Gestor ou team leader desta imobiliária
                </Label>
                <Select value={escolha} onValueChange={setEscolha}>
                  <SelectTrigger id="testemunha-2-escolha" className="w-72">
                    <SelectValue
                      placeholder={
                        lista.length ? "Escolha" : "Ninguém disponível nesta imobiliária"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {lista.map((c) => (
                      <SelectItem key={c.id} value={c.id} disabled={!c.ok}>
                        {c.nome}
                        {c.daEquipe ? " (líder da equipe)" : ""}
                        {c.ok ? "" : ` — falta ${c.falta ?? "cadastro"}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" disabled={busy || !escolha} onClick={() => void salvar(escolha)}>
                Usar como testemunha 2
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setLista(null)}>
                Cancelar
              </Button>
            </div>
          )}
          {t.pdfGerado && (
            <p className="text-xs text-muted-foreground">
              Trocar a testemunha exige gerar o PDF para assinatura de novo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
