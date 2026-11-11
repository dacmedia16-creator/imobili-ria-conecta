import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Lightbulb, MessageSquareWarning, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ListSkeleton, PageHeader, Pill, type Tom } from "@/components/visual/base";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { ajudaMaxLocacaoEnabled, guardLocacaoRoute } from "@/lib/locacao-db";
import {
  STATUS_GESTAO,
  dataHoraBr,
  filtrarEnvios,
  lerEnvios,
  resumoEnvios,
  statusEnvioLabel,
  tipoEnvioLabel,
  type FiltroEnvio,
  type ListaEnvios,
  type StatusEnvio,
} from "@/lib/ajuda-max-locacao-sugestoes";
import { linkDoPrintLocacao } from "@/lib/ajuda-max-locacao-sugestoes.functions";

// Ajuda MAX na Locação — fatia 2/2 (t_365484dc; maquete t_8e76e1c3 aprovada por Denis em 11/11/2026).
// Tela "Sugestões e erros": o que o time mandou pelo balão. Gestão/staff vê tudo da imobiliária; o usuário comum vê
// só os próprios envios. O banco decide (ajuda_max_locacao_sugestoes) e exige a chave + Locação ligadas.
const db = supabase as unknown as SupabaseClient;

export const Route = createFileRoute("/_authenticated/locacoes/sugestoes")({
  head: () => ({ meta: [{ title: "Sugestões e erros" }] }),
  beforeLoad: async () => {
    await guardLocacaoRoute();
    if (!(await ajudaMaxLocacaoEnabled())) throw redirect({ to: "/locacoes" });
  },
  component: SugestoesPage,
});

const TOM_TIPO: Record<string, Tom> = { sugestao: "green", erro: "red", duvida: "blue" };
const TOM_STATUS: Record<string, Tom> = {
  recebido: "slate",
  em_analise: "amber",
  respondido: "blue",
  resolvido: "green",
};
const FILTROS: { f: FiltroEnvio; label: string }[] = [
  { f: "todos", label: "Todos" },
  { f: "sugestao", label: "Ideias" },
  { f: "erro", label: "Erros" },
  { f: "duvida", label: "Dúvidas sem resposta" },
];

function SugestoesPage() {
  const [dados, setDados] = useState<ListaEnvios | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroEnvio>("todos");
  const [soMeus, setSoMeus] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const abrirPrint = useServerFn(linkDoPrintLocacao);

  const carregar = useCallback(async () => {
    const { data, error } = await db.rpc("ajuda_max_locacao_sugestoes");
    if (error) setErro(errorMessage(error, "Não foi possível carregar os envios."));
    else {
      setErro(null);
      setDados(lerEnvios(data));
    }
  }, []);
  useEffect(() => void carregar(), [carregar]);

  const base = useMemo(
    () => (dados ? filtrarEnvios(dados.itens, "todos", soMeus) : []),
    [dados, soMeus],
  );
  const lista = useMemo(() => filtrarEnvios(base, filtro, false), [base, filtro]);
  const resumo = resumoEnvios(base);

  if (erro)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{erro}</p>
        <Button variant="outline" onClick={() => void carregar()}>
          Tentar de novo
        </Button>
      </div>
    );
  if (!dados) return <ListSkeleton />;

  const mudarStatus = async (id: string, status: StatusEnvio) => {
    setSalvando(id);
    const { error } = await db.rpc("ajuda_max_locacao_sugestao_status", {
      _ticket: id,
      _status: status,
    });
    setSalvando(null);
    if (error) toast.error(errorMessage(error, "Não foi possível mudar o status."));
    else {
      toast.success(`Status: ${statusEnvioLabel(status)}`);
      void carregar();
    }
  };

  const verPrint = async (id: string) => {
    // Mesmo padrão do chamado (ChamadoDetalhe): link assinado de 5 min numa aba nova.
    try {
      const { url } = await abrirPrint({ data: { ticketId: id } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(errorMessage(e, "Print indisponível."));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Lightbulb}
        title="Sugestões e erros"
        description="O que o time mandou pelo balão Ajuda MAX. Sem dados de cliente. Isolado por imobiliária."
      />
      <p
        className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        data-testid="sugestoes-visao"
      >
        {dados.gestao
          ? "Visão gestão: todos os envios desta imobiliária. Você pode mudar o status."
          : "Você vê só o que você mesmo enviou."}
      </p>

      {dados.gestao && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={soMeus ? "outline" : "default"}
            onClick={() => setSoMeus(false)}
          >
            Todos da imobiliária
          </Button>
          <Button
            size="sm"
            variant={soMeus ? "default" : "outline"}
            onClick={() => setSoMeus(true)}
          >
            Só os meus
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["envios visíveis", resumo.total],
          ["ideias", resumo.ideias],
          ["erros", resumo.erros],
          ["novos", resumo.novos],
        ].map(([l, n]) => (
          <div key={l} className="rounded-lg border bg-card px-3 py-2">
            <div className="text-xl font-semibold">{n}</div>
            <div className="text-xs text-muted-foreground">{l}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por tipo">
        {FILTROS.map(({ f, label }) => (
          <button
            key={f}
            type="button"
            aria-pressed={filtro === f}
            onClick={() => setFiltro(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filtro === f ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {lista.length === 0 ? (
        <EmptyState icon={MessageSquareWarning}>
          Nenhum envio por aqui ainda. Use o balão Ajuda MAX nas telas da Locação para dar uma ideia
          ou relatar um erro.
        </EmptyState>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* Celular: cartões. Computador: tabela, como na maquete. */}
            <ul className="divide-y md:hidden" data-testid="sugestoes-cartoes">
              {lista.map((i) => (
                <li key={i.id} className="space-y-1.5 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tom={TOM_TIPO[i.tipo] ?? "slate"}>{tipoEnvioLabel(i.tipo)}</Pill>
                    <Pill tom={TOM_STATUS[i.status] ?? "slate"}>{statusEnvioLabel(i.status)}</Pill>
                    <span className="text-xs text-muted-foreground">#{i.numero}</span>
                  </div>
                  <p className="break-words">{i.texto}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.autorNome} · {i.telaNome} · {dataHoraBr(i.createdAt)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {i.temPrint && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => void verPrint(i.id)}
                      >
                        <Paperclip className="mr-1 h-3.5 w-3.5" /> Ver print
                      </Button>
                    )}
                    {dados.gestao && (
                      <SeletorStatus
                        id={i.id}
                        status={i.status}
                        disabled={salvando === i.id}
                        onChange={mudarStatus}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm" data-testid="sugestoes-tabela">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Envio</th>
                    <th className="px-3 py-2">Quem enviou</th>
                    <th className="px-3 py-2">Tela de origem</th>
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Anexo</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lista.map((i) => (
                    <tr key={i.id} className="align-top">
                      <td className="px-3 py-2">
                        <Pill tom={TOM_TIPO[i.tipo] ?? "slate"}>{tipoEnvioLabel(i.tipo)}</Pill>
                      </td>
                      <td className="max-w-sm px-3 py-2">
                        <span className="text-xs text-muted-foreground">#{i.numero} </span>
                        <span className="break-words">{i.texto}</span>
                      </td>
                      <td className="px-3 py-2">{i.autorNome}</td>
                      <td className="px-3 py-2">{i.telaNome}</td>
                      <td className="whitespace-nowrap px-3 py-2">{dataHoraBr(i.createdAt)}</td>
                      <td className="px-3 py-2">
                        {i.temPrint ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                            onClick={() => void verPrint(i.id)}
                          >
                            <Paperclip className="h-3.5 w-3.5" /> print
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {dados.gestao ? (
                          <SeletorStatus
                            id={i.id}
                            status={i.status}
                            disabled={salvando === i.id}
                            onChange={mudarStatus}
                          />
                        ) : (
                          <Pill tom={TOM_STATUS[i.status] ?? "slate"}>
                            {statusEnvioLabel(i.status)}
                          </Pill>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SeletorStatus({
  id,
  status,
  disabled,
  onChange,
}: {
  id: string;
  status: StatusEnvio;
  disabled: boolean;
  onChange: (id: string, s: StatusEnvio) => void;
}) {
  const opcoes = STATUS_GESTAO.includes(status) ? STATUS_GESTAO : [status, ...STATUS_GESTAO];
  return (
    <select
      aria-label="Status do envio"
      className="h-8 rounded-md border bg-background px-2 text-xs"
      value={status}
      disabled={disabled}
      onChange={(e) => onChange(id, e.target.value as StatusEnvio)}
    >
      {opcoes.map((s) => (
        <option key={s} value={s}>
          {statusEnvioLabel(s)}
        </option>
      ))}
    </select>
  );
}
