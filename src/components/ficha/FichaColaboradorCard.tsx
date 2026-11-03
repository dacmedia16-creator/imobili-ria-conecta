/**
 * Card somente leitura com a ficha de UM colaborador (t_02c8d570).
 * Mostra só o que a tela "Ficha dos colaboradores" já recebeu para a linha: sem consulta nova,
 * sem edição. Fecha com o X, Esc e clique fora (Dialog do shadcn/Radix).
 */
import type { ReactNode } from "react";
import { FileDown } from "lucide-react";
import { Pill } from "@/components/visual/base";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  dataBr,
  dataHoraSp,
  filhosComFaixas,
  rotuloPapeis,
  textoPendencias,
  type Colaborador,
} from "@/lib/ficha-colaborador";

const VAZIO = "—";
const ou = (v: string | null | undefined) => (v && v.trim() ? v : VAZIO);

export function FichaColaboradorCard({
  colaborador: c,
  labels,
  onClose,
  onPdf,
  gerandoPdf,
}: {
  colaborador: Colaborador | null;
  labels: Record<string, string>;
  onClose: () => void;
  onPdf?: (c: Colaborador) => void;
  gerandoPdf?: boolean;
}) {
  return (
    <Dialog open={!!c} onOpenChange={(aberto) => !aberto && onClose()}>
      <DialogContent className="sm:max-w-2xl" data-testid="ficha-card">
        {c && (
          <>
            <DialogHeader className="pr-8 text-left">
              <DialogTitle className="break-words">{c.nome}</DialogTitle>
              <DialogDescription className="break-all">{ou(c.email)}</DialogDescription>
              <div className="flex flex-wrap gap-2 pt-1">
                {c.completa ? (
                  <Pill tom="green">Ficha completa</Pill>
                ) : (
                  <Pill tom="amber">Ficha pendente</Pill>
                )}
                {c.cadastro_pendente.length ? (
                  <Pill tom="amber">Cadastro pendente</Pill>
                ) : (
                  <Pill tom="green">Cadastro completo</Pill>
                )}
              </div>
            </DialogHeader>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Secao titulo="Dados gerais">
                <Item rotulo="Papel">{ou(rotuloPapeis(c.papeis, labels))}</Item>
                <Item rotulo="Equipe">{ou(c.equipes.join(", "))}</Item>
                <Item rotulo="Nascimento">{ou(dataBr(c.data_nascimento))}</Item>
                <Item rotulo="Pendências do cadastro">
                  {c.cadastro_pendente.length ? (
                    <span className="text-amber-700 dark:text-amber-400">
                      {textoPendencias(c.cadastro_pendente)}
                    </span>
                  ) : (
                    "Nenhuma"
                  )}
                </Item>
                <Item rotulo="Religião">{ou(c.religiao)}</Item>
              </Secao>

              <Secao titulo="Família e saúde">
                <Item rotulo="Filhos">{ou(filhosComFaixas(c))}</Item>
                <Item rotulo="Plano de saúde">
                  {c.tem_plano_saude == null
                    ? VAZIO
                    : c.tem_plano_saude
                      ? ou(c.plano_saude)
                      : "Não tem"}
                </Item>
                <Item rotulo="Hospital de preferência">{ou(c.hospital_preferencia)}</Item>
              </Secao>

              <Secao titulo="Contato de emergência">
                <Item rotulo="Nome">{ou(c.emergencia_nome)}</Item>
                <Item rotulo="Parentesco">{ou(c.emergencia_parentesco)}</Item>
                <Item rotulo="Telefone">{ou(c.emergencia_telefone)}</Item>
              </Secao>

              <Secao titulo="Ficha">
                <Item rotulo="Preenchida em">{ou(dataHoraSp(c.preenchida_em))}</Item>
                <Item rotulo="Atualizada em">{ou(dataHoraSp(c.updated_at))}</Item>
              </Secao>
            </div>

            {onPdf && (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  data-testid="ficha-card-pdf"
                  onClick={() => onPdf(c)}
                  disabled={gerandoPdf}
                >
                  <FileDown className="h-4 w-4" aria-hidden />
                  {gerandoPdf ? "Gerando…" : "PDF desta ficha"}
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-muted/30 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h3>
      <dl className="space-y-2">{children}</dl>
    </section>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="text-sm">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="break-words font-medium">{children}</dd>
    </div>
  );
}
