import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SlidersHorizontal, ChevronDown, X } from "lucide-react";
import { COMISSAO_PAPEIS } from "@/lib/status";
import { filtrosPadraoFinanceiro } from "@/lib/financeiro-dashboard-calc";
import type {
  FinanceiroFiltros,
  SituacaoRecebimentoFiltro,
} from "@/lib/financeiro-dashboard-types";

const SITUACAO_RECEBIMENTO_LABEL: Record<SituacaoRecebimentoFiltro, string> = {
  todas: "Todas as situações",
  recebido: "Recebido",
  parcial: "Recebido parcialmente",
  a_vencer: "A vencer",
  vencido: "Vencido",
  sem_previsao: "Sem previsão",
};

function mesAtualRange() {
  const hoje = new Date();
  const de = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
  const ate = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { de, ate };
}
function ultimosNDiasRange(n: number) {
  const ate = new Date().toISOString().slice(0, 10);
  const d = new Date();
  d.setDate(d.getDate() - n);
  return { de: d.toISOString().slice(0, 10), ate };
}

export function Filters({
  filtros,
  onChange,
  corretorOptions,
  gestorOptions,
  teamOptions,
  periodoLabel,
}: {
  filtros: FinanceiroFiltros;
  onChange: (next: FinanceiroFiltros) => void;
  corretorOptions: { id: string; label: string }[];
  gestorOptions: { id: string; label: string }[];
  teamOptions: { id: string; label: string }[];
  periodoLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof FinanceiroFiltros>(key: K, value: FinanceiroFiltros[K]) =>
    onChange({ ...filtros, [key]: value });
  const aplicarAtalho = (range: { de: string; ate: string }) =>
    onChange({ ...filtros, dataDe: range.de, dataAte: range.ate });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        {/* <640px: busca numa linha inteira, botões numa linha própria abaixo — na largura do
            Input original, "Limpar filtros" e "Filtros" espremiam o campo de busca até sobrar só
            "Bus..." visível. sm: volta ao layout de uma linha só (desktop preservado). */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            placeholder="Buscar por código interno ou imóvel"
            value={filtros.busca}
            onChange={(e) => set("busca", e.target.value)}
            className="w-full sm:flex-1 sm:max-w-sm"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(filtrosPadraoFinanceiro())}
            >
              <X className="mr-1 h-4 w-4" />
              Limpar filtros
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 md:hidden"
              onClick={() => setOpen((v) => !v)}
            >
              <SlidersHorizontal className="mr-1 h-4 w-4" />
              Filtros
              <ChevronDown
                className={`ml-1 h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{periodoLabel}</p>

        <div
          className={`${open ? "flex" : "hidden"} flex-col gap-3 md:flex md:flex-row md:flex-wrap md:items-end`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Período — de</Label>
              <Input
                type="date"
                value={filtros.dataDe}
                onChange={(e) => set("dataDe", e.target.value)}
                className="w-[9.5rem]"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">até</Label>
              <Input
                type="date"
                value={filtros.dataAte}
                onChange={(e) => set("dataAte", e.target.value)}
                className="w-[9.5rem]"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => aplicarAtalho(mesAtualRange())}
            >
              Mês atual
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => aplicarAtalho(ultimosNDiasRange(30))}
            >
              Últimos 30 dias
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => aplicarAtalho(ultimosNDiasRange(90))}
            >
              Últimos 90 dias
            </Button>
          </div>

          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Modalidade</Label>
            <Select
              value={filtros.modalidade}
              onValueChange={(v) => set("modalidade", v as FinanceiroFiltros["modalidade"])}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="padrao">Venda tradicional</SelectItem>
                <SelectItem value="lancamento">Lançamento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">
              Situação do recebimento
            </Label>
            <Select
              value={filtros.situacaoRecebimento}
              onValueChange={(v) => set("situacaoRecebimento", v as SituacaoRecebimentoFiltro)}
            >
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SITUACAO_RECEBIMENTO_LABEL) as SituacaoRecebimentoFiltro[]).map(
                  (k) => (
                    <SelectItem key={k} value={k}>
                      {SITUACAO_RECEBIMENTO_LABEL[k]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">
              Papel do beneficiário
            </Label>
            <Select
              value={filtros.papel ?? "todos"}
              onValueChange={(v) => set("papel", v === "todos" ? null : v)}
            >
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os papéis</SelectItem>
                {COMISSAO_PAPEIS.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {corretorOptions.length > 0 && (
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Corretor</Label>
              <Select
                value={filtros.corretorId ?? "todos"}
                onValueChange={(v) => set("corretorId", v === "todos" ? null : v)}
              >
                <SelectTrigger className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os corretores</SelectItem>
                  {corretorOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {gestorOptions.length > 0 && (
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Gestor</Label>
              <Select
                value={filtros.gestorId ?? "todos"}
                onValueChange={(v) => set("gestorId", v === "todos" ? null : v)}
              >
                <SelectTrigger className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os gestores</SelectItem>
                  {gestorOptions.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {teamOptions.length > 0 && (
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Equipe</Label>
              <Select
                value={filtros.teamId ?? "todas"}
                onValueChange={(v) => set("teamId", v === "todas" ? null : v)}
              >
                <SelectTrigger className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as equipes</SelectItem>
                  {teamOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id="incluir-canceladas-fin"
              checked={filtros.incluirCanceladas}
              onCheckedChange={(v) => set("incluirCanceladas", !!v)}
            />
            <Label
              htmlFor="incluir-canceladas-fin"
              className="cursor-pointer text-xs font-normal text-muted-foreground"
            >
              Incluir canceladas/arquivadas (histórico)
            </Label>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
