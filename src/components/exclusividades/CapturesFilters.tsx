import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TEMPLATES, type Capture } from "@/lib/exclusive-captures";
import {
  bairroLabel,
  EMPTY_FILTERS,
  filtersActive,
  SITUATION_LABEL,
  type Filters,
} from "@/lib/exclusive-captures-dashboard";

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));

/** Filtros das captações — mesmos na lista e no painel. Opções vêm só das captações que o usuário vê. */
export function CapturesFilters({
  captures,
  value,
  onChange,
  showSearch = false,
}: {
  captures: Capture[];
  value: Filters;
  onChange: (f: Filters) => void;
  showSearch?: boolean;
}) {
  const set = (k: keyof Filters) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          label="Período (criação)"
          value={value.periodo}
          onChange={set("periodo")}
          options={[
            ["tudo", "Tudo"],
            ["30", "Últimos 30 dias"],
            ["90", "Últimos 90 dias"],
            ["180", "Últimos 180 dias"],
            ["365", "Últimos 12 meses"],
          ]}
        />
        <Select
          label="Corretor"
          value={value.corretor}
          onChange={set("corretor")}
          options={[
            ["", "Todos"],
            ...uniq(captures.map((c) => c.broker_name || "—")).map((n): [string, string] => [n, n]),
          ]}
        />
        <Select
          label="Unidade"
          value={value.unidade}
          onChange={set("unidade")}
          options={[["", "Todas"], ...(Object.entries(TEMPLATES) as [string, string][])]}
        />
        <Select
          label="Bairro"
          value={value.bairro}
          onChange={set("bairro")}
          options={[
            ["", "Todos"],
            ...uniq(captures.map(bairroLabel)).map((n): [string, string] => [n, n]),
          ]}
        />
        <Select
          label="Situação"
          value={value.situacao}
          onChange={set("situacao")}
          options={[["", "Todas"], ...(Object.entries(SITUATION_LABEL) as [string, string][])]}
        />
      </div>
      {(showSearch || filtersActive(value)) && (
        <div className="flex flex-wrap items-end gap-2">
          {showSearch && (
            <Input
              className="max-w-sm"
              placeholder="Buscar por endereço, bairro, tipo ou corretor"
              value={value.busca}
              onChange={(e) => set("busca")(e.target.value)}
            />
          )}
          {filtersActive(value) && (
            <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
              Limpar filtros
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
