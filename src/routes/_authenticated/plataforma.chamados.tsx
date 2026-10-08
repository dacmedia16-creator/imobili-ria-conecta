import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ChamadoDetalhe,
  rpcLivre,
  SeloStatus,
  SeloTipo,
  type ChamadoLinha,
} from "@/components/ChamadoDetalhe";
import {
  filtrarChamados,
  idade,
  resumoCentral,
  STATUS_LABEL,
  STATUS_ORDEM,
  TIPO_LABEL,
  type FiltroCentral,
} from "@/lib/ajuda-sugestoes";
import { guardPlatformRoute } from "./plataforma.imobiliarias";

export const Route = createFileRoute("/_authenticated/plataforma/chamados")({
  head: () => ({ meta: [{ title: "Central de chamados" }] }),
  beforeLoad: guardPlatformRoute,
  component: CentralChamados,
});

const PAPEL: Record<string, string> = {
  corretor: "Corretor",
  gestor: "Gestor",
  team_leader: "Team Leader",
  admin: "Admin",
  super_admin: "Super admin",
  financeiro: "Financeiro",
};

const selectCls = "h-9 rounded-md border bg-background px-2 text-sm";

function CentralChamados() {
  const [lista, setLista] = useState<ChamadoLinha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [f, setF] = useState<FiltroCentral>({
    organizacao: "",
    tipo: "",
    status: "abertos",
    busca: "",
  });

  const carregar = useCallback(async () => {
    const { data, error } = await rpcLivre("support_ticket_list", { _escopo: "todos" });
    if (error) toast.error(error.message);
    setLista((data as ChamadoLinha[] | null) ?? []);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const orgs = useMemo(
    () =>
      Array.from(new Map(lista.map((c) => [c.organization_id, c.organizacao])).entries()).sort(
        (a, b) => a[1].localeCompare(b[1]),
      ),
    [lista],
  );
  const visiveis = filtrarChamados(lista, f);
  const resumo = resumoCentral(lista);
  const atual = lista.find((c) => c.id === sel) ?? null;
  const papel = (p: string | null) =>
    (p ?? "")
      .split(",")
      .filter(Boolean)
      .map((r) => PAPEL[r] ?? r)
      .join(", ");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Central de chamados — equipe MAX</h1>
        <p className="text-sm text-muted-foreground">
          Todos os chamados de todas as imobiliárias. Só a equipe MAX (super admin da plataforma) vê
          esta tela.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Abertos", resumo.abertos],
          ["Recebidos (sem resposta)", resumo.recebidos],
          ["Erros abertos", resumo.errosAbertos],
          ["Resolvidos (30 dias)", resumo.resolvidos30d],
        ].map(([rotulo, n]) => (
          <Card key={rotulo as string}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{rotulo}</div>
              <div className="text-2xl font-semibold">{n}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Imobiliária"
          className={selectCls}
          value={f.organizacao}
          onChange={(e) => setF({ ...f, organizacao: e.target.value })}
        >
          <option value="">Todas as imobiliárias</option>
          {orgs.map(([id, nome]) => (
            <option key={id} value={id}>
              {nome}
            </option>
          ))}
        </select>
        <select
          aria-label="Tipo"
          className={selectCls}
          value={f.tipo}
          onChange={(e) => setF({ ...f, tipo: e.target.value })}
        >
          <option value="">Todos os tipos</option>
          {Object.entries(TIPO_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          className={selectCls}
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value })}
        >
          <option value="abertos">Abertos (sem Resolvido)</option>
          <option value="">Todos os status</option>
          {STATUS_ORDEM.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <Input
          className="h-9 w-56"
          placeholder="Buscar texto ou #número"
          value={f.busca}
          onChange={(e) => setF({ ...f, busca: e.target.value })}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">Imobiliária / quem</th>
                  <th className="p-2">Tipo</th>
                  <th className="p-2">Assunto</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Idade</th>
                </tr>
              </thead>
              <tbody>
                {carregando && (
                  <tr>
                    <td colSpan={6} className="p-4 text-muted-foreground">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!carregando && visiveis.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground">
                      Nenhum chamado com esses filtros.
                    </td>
                  </tr>
                )}
                {visiveis.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSel(c.id)}
                    className={`cursor-pointer border-b ${sel === c.id ? "bg-primary/10" : "hover:bg-muted"}`}
                  >
                    <td className="p-2 font-medium">{c.numero}</td>
                    <td className="p-2">
                      <div>{c.organizacao}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.autor_nome ?? "Usuário"}
                        {papel(c.autor_papeis) && ` · ${papel(c.autor_papeis)}`}
                      </div>
                    </td>
                    <td className="p-2">
                      <SeloTipo tipo={c.tipo} />
                    </td>
                    <td className="max-w-[16rem] p-2">
                      <span className="line-clamp-2">
                        {c.tem_print && <Paperclip className="mr-1 inline h-3 w-3" />}
                        {c.assunto}
                      </span>
                    </td>
                    <td className="p-2">
                      <SeloStatus status={c.status} />
                    </td>
                    <td className="whitespace-nowrap p-2 text-muted-foreground">
                      {idade(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            {atual ? (
              <ChamadoDetalhe key={atual.id} chamado={atual} modo="equipe" onMudou={carregar} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Escolha um chamado na lista.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
