import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SlidersHorizontal, ChevronDown } from "lucide-react";
import type { FiltrosProducao } from "@/lib/producao-por-pessoa-types";
import { anoAtualRange, mesAtualRange, ultimosNDiasRange } from "@/lib/producao-por-pessoa-filters";

const TIPO_LABEL: Record<FiltrosProducao["tipo"], string> = {
  todas: "Captação + venda",
  captacao: "Só captação",
  venda: "Só venda",
};

export function Filters({
  filtros,
  onChange,
  pessoaOptions,
  teamOptions,
}: {
  filtros: FiltrosProducao;
  onChange: (next: FiltrosProducao) => void;
  pessoaOptions: { id: string; label: string }[];
  teamOptions: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof FiltrosProducao>(key: K, value: FiltrosProducao[K]) =>
    onChange({ ...filtros, [key]: value });

  const aplicarAtalho = (range: { de: string; ate: string }) =>
    onChange({ ...filtros, dataDe: range.de, dataAte: range.ate });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Filtros</span>
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

        <div
          className={`${open ? "flex" : "hidden"} flex-col gap-3 md:flex md:flex-row md:flex-wrap md:items-end`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Conclusão — de</Label>
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => aplicarAtalho(anoAtualRange())}
            >
              Ano atual
            </Button>
          </div>

          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Tipo de participação</Label>
            <Select
              value={filtros.tipo}
              onValueChange={(v) => set("tipo", v as FiltrosProducao["tipo"])}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TIPO_LABEL) as FiltrosProducao["tipo"][]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {TIPO_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {pessoaOptions.length > 0 && (
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Pessoa</Label>
              <Select
                value={filtros.pessoaId ?? "todas"}
                onValueChange={(v) => set("pessoaId", v === "todas" ? null : v)}
              >
                <SelectTrigger className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as pessoas</SelectItem>
                  {pessoaOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
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
        </div>
      </CardHeader>
    </Card>
  );
}
