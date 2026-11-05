import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Phone, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ListSkeleton, Pill } from "@/components/visual/base";
import { fotosDb } from "@/lib/vouchers-fotos-module";
import {
  dinheiro,
  mensagemErroFoto,
  quando,
  type FinanceiroFotos as Fin,
} from "@/lib/vouchers-fotos";

/** Financeiro das fotos: "RE/MAX paga (com voucher)" e "A cobrar dos corretores (sem voucher)". */
export function FinanceiroFotos({ hoje }: { hoje: string }) {
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [dados, setDados] = useState<Fin | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    const { data, error } = await fotosDb.rpc("photo_financeiro", { _mes: `${mes}-01` });
    if (error) setErro(mensagemErroFoto(error, "Não foi possível carregar o financeiro das fotos."));
    else setDados(data as Fin);
  }, [mes]);
  useEffect(() => {
    setDados(null);
    void carregar();
  }, [carregar]);

  const marcar = async (id: string, cobrado: boolean) => {
    setSalvando(id);
    const { error } = await fotosDb.rpc("photo_marcar_cobrado", { _session: id, _cobrado: cobrado });
    setSalvando(null);
    if (error) return toast.error(mensagemErroFoto(error, "Não foi possível salvar."));
    toast.success(cobrado ? "Marcado como cobrado." : "Voltou para a cobrar.");
    void carregar();
  };

  return (
    <div className="space-y-4" data-testid="financeiro-fotos">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Mês</span>
          <Input
            type="month"
            value={mes}
            onChange={(e) => e.target.value && setMes(e.target.value)}
            className="w-44"
            aria-label="Mês do financeiro das fotos"
          />
        </label>
      </div>
      {erro ? (
        <p className="text-sm text-destructive">{erro}</p>
      ) : !dados ? (
        <ListSkeleton />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">RE/MAX paga (com voucher)</CardTitle>
              <p className="text-2xl font-semibold tabular-nums" data-testid="total-remax">
                {dinheiro(dados.remax_total)}
              </p>
              <p className="text-xs text-muted-foreground">
                {dados.remax.length} sessão(ões) feita(s) no mês, valor congelado na conclusão.
              </p>
            </CardHeader>
            <CardContent>
              {dados.remax.length === 0 ? (
                <EmptyState icon={Receipt}>Nenhuma sessão com voucher feita neste mês.</EmptyState>
              ) : (
                <ul className="divide-y text-sm">
                  {dados.remax.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{s.corretor_nome ?? "Corretor"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {quando(s.inicio)} · {s.imovel ?? "Imóvel"}
                        </p>
                      </div>
                      <span className="tabular-nums">{dinheiro(s.valor_congelado)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">A cobrar dos corretores (sem voucher)</CardTitle>
              <p className="text-2xl font-semibold tabular-nums" data-testid="total-a-cobrar">
                {dinheiro(dados.a_cobrar_total)}
              </p>
              <p className="text-xs text-muted-foreground">
                Cobrança por telefone. Marque “cobrado” depois de falar com o corretor.
              </p>
            </CardHeader>
            <CardContent>
              {dados.a_cobrar.length === 0 ? (
                <EmptyState icon={Receipt}>Nada a cobrar neste mês.</EmptyState>
              ) : (
                <ul className="divide-y text-sm" data-testid="lista-a-cobrar">
                  {dados.a_cobrar.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{s.corretor_nome ?? "Corretor"}</p>
                        {s.corretor_telefone && (
                          <a
                            href={`tel:${s.corretor_telefone.replace(/\D/g, "")}`}
                            className="inline-flex items-center gap-1 text-xs text-primary underline"
                          >
                            <Phone className="h-3 w-3" aria-hidden /> {s.corretor_telefone}
                          </a>
                        )}
                        <p className="truncate text-xs text-muted-foreground">
                          {quando(s.inicio)} · {s.imovel ?? "Imóvel"}
                        </p>
                      </div>
                      <span className="tabular-nums">{dinheiro(s.valor_congelado)}</span>
                      {s.cobranca_status === "cobrado" ? (
                        <>
                          <Pill tom="green">Cobrado</Pill>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={salvando === s.id}
                            onClick={() => void marcar(s.id, false)}
                          >
                            Desfazer
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={salvando === s.id}
                          onClick={() => void marcar(s.id, true)}
                          data-testid="botao-cobrado"
                        >
                          Cobrado
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
