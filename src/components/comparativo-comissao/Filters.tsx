import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SlidersHorizontal, ChevronDown, X } from "lucide-react";
import type { ComparativoFiltros, SituacaoFiltro } from "@/lib/comparativo-comissao-types";
import { anoAtualRange, filtrosPadrao, mesAtualRange, ultimosNDiasRange } from "@/lib/comparativo-comissao-filters";

const SITUACAO_LABEL: Record<SituacaoFiltro, string> = {
  todas: "Todas as situações", abaixo: "Abaixo de 6%", igual: "Igual a 6%", acima: "Acima de 6%",
};

export function Filters({
  filtros, onChange, corretorOptions, teamOptions,
}: {
  filtros: ComparativoFiltros;
  onChange: (next: ComparativoFiltros) => void;
  corretorOptions: { id: string; label: string }[];
  teamOptions: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof ComparativoFiltros>(key: K, value: ComparativoFiltros[K]) => onChange({ ...filtros, [key]: value });

  const aplicarAtalho = (range: { de: string; ate: string }) => onChange({ ...filtros, dataDe: range.de, dataAte: range.ate });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            placeholder="Buscar por código ou identificação do imóvel"
            value={filtros.busca}
            onChange={(e) => set("busca", e.target.value)}
            className="w-full sm:flex-1 sm:max-w-sm"
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(filtrosPadrao())}>
              <X className="mr-1 h-4 w-4" />
              Limpar filtros
            </Button>
            <Button type="button" variant="outline" size="sm" className="shrink-0 md:hidden" onClick={() => setOpen((v) => !v)}>
              <SlidersHorizontal className="mr-1 h-4 w-4" />
              Filtros
              <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </Button>
          </div>
        </div>

        <div className={`${open ? "flex" : "hidden"} flex-col gap-3 md:flex md:flex-row md:flex-wrap md:items-end`}>
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">De</Label>
              <Input type="date" value={filtros.dataDe} onChange={(e) => set("dataDe", e.target.value)} className="w-[9.5rem]" />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">até</Label>
              <Input type="date" value={filtros.dataAte} onChange={(e) => set("dataAte", e.target.value)} className="w-[9.5rem]" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => aplicarAtalho(mesAtualRange())}>Mês atual</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => aplicarAtalho(ultimosNDiasRange(30))}>Últimos 30 dias</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => aplicarAtalho(ultimosNDiasRange(90))}>Últimos 90 dias</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => aplicarAtalho(anoAtualRange())}>Ano atual</Button>
          </div>

          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Modalidade</Label>
            <Select value={filtros.modalidade} onValueChange={(v) => set("modalidade", v as ComparativoFiltros["modalidade"])}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="padrao">Venda tradicional</SelectItem>
                <SelectItem value="lancamento">Lançamento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Situação da comissão</Label>
            <Select value={filtros.situacao} onValueChange={(v) => set("situacao", v as SituacaoFiltro)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(SITUACAO_LABEL) as SituacaoFiltro[]).map((k) => <SelectItem key={k} value={k}>{SITUACAO_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {corretorOptions.length > 0 && (
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Corretor</Label>
              <Select value={filtros.corretorId ?? "todos"} onValueChange={(v) => set("corretorId", v === "todos" ? null : v)}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os corretores</SelectItem>
                  {corretorOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {teamOptions.length > 0 && (
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Equipe</Label>
              <Select value={filtros.teamId ?? "todas"} onValueChange={(v) => set("teamId", v === "todas" ? null : v)}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as equipes</SelectItem>
                  {teamOptions.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardHeader>
    </Card>
  );
}
