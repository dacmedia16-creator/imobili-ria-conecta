// Lista de proprietários da captação em blocos recolhíveis (t_58effd65). Usável com 30+: cada bloco
// fechado é só uma linha (número, nome e selo de pendências); apenas o bloco aberto monta os campos e
// os envios de documento, então a tela não vira uma página gigante.
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MAX_OWNERS,
  ownerPendencies,
  type DocumentKind,
  type Owner,
} from "@/lib/exclusive-captures";

export type OwnerBlocksProps = {
  owners: Owner[];
  /** Tipos de documento por owner_index (ownerDocKinds), calculado uma vez pela tela. */
  docKinds: Map<number, Set<DocumentKind>>;
  /** Conteúdo do bloco aberto (campos ou documentos) do proprietário N (1, 2, 3…). */
  renderBody: (n: number) => ReactNode;
  /** "docs" = selo de documento; "fields" = selo de campos; "both" = os dois. */
  badges: "docs" | "fields" | "both";
  /** Documentos do proprietário são opcionais (cadastro manual): o selo vira só informativo. */
  docsOptional?: boolean;
  editable: boolean;
  busy: boolean;
  onAdd?: () => void;
  onRemove?: (n: number) => void;
  /** Motivo para não remover o N (null = pode remover). */
  removeBlocked?: (n: number) => string | null;
  title?: string;
};

export function OwnerBlocks(p: OwnerBlocksProps) {
  // Começa com o 1º aberto (captação de 1 ou 2 proprietários fica igual a hoje: tudo à vista).
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(p.owners.length <= 2 ? p.owners.map((_, i) => i + 1) : [1]),
  );
  const toggle = (n: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  const pend = p.owners.map((o, i) => ownerPendencies(o, p.docKinds.get(i + 1)));
  const withPend = pend
    .map((x, i) => {
      const docs = p.badges !== "fields" && x.docs && !p.docsOptional;
      const fields = p.badges !== "docs" && x.fields > 0;
      return docs || fields ? i + 1 : 0;
    })
    .filter(Boolean);
  const total = p.owners.length;
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">
          {p.title ?? "Proprietários"} ({total})
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {withPend.length
            ? `${withPend.length} com pendência: ${withPend.slice(0, 12).join(", ")}${withPend.length > 12 ? "…" : ""}`
            : "Nenhuma pendência nos proprietários."}
        </p>
        {total > 2 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setOpen(new Set())}>
              Recolher todos
            </Button>
            {withPend.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setOpen(new Set([withPend[0]]))}>
                Abrir o próximo pendente ({withPend[0]}º)
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {p.owners.map((o, i) => {
          const n = i + 1;
          const isOpen = open.has(n);
          const x = pend[i];
          const blocked = p.removeBlocked?.(n) ?? null;
          const showDocs = p.badges !== "fields";
          const showFields = p.badges !== "docs";
          return (
            <div key={n} className="rounded-md border" data-owner={n}>
              <div className="flex flex-wrap items-center gap-2 p-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={isOpen}
                  aria-label={`Proprietário ${n}`}
                  onClick={() => toggle(n)}
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )}
                  <span className="shrink-0 font-medium">Proprietário {n}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {o.nome_completo?.trim() || "Nome a preencher"}
                  </span>
                </button>
                {showDocs &&
                  (x.docs ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${p.docsOptional ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-900"}`}
                    >
                      {p.docsOptional ? "sem RG + CPF ou CNH" : "documento pendente"}
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                      identificação completa
                    </span>
                  ))}
                {showFields && x.fields > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                    {x.fields} {x.fields === 1 ? "campo pendente" : "campos pendentes"}
                  </span>
                )}
                {p.editable && p.onRemove && n > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={p.busy || !!blocked}
                    title={blocked ?? `Remover proprietário ${n}`}
                    aria-label={`Remover proprietário ${n}`}
                    onClick={() => {
                      if (window.confirm(`Remover o proprietário ${n}?`)) p.onRemove?.(n);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {isOpen && <div className="space-y-3 border-t p-3">{p.renderBody(n)}</div>}
            </div>
          );
        })}
        {p.editable && p.onAdd && (
          <Button
            variant="outline"
            disabled={p.busy || total >= MAX_OWNERS}
            onClick={() => {
              p.onAdd?.();
              setOpen(new Set([total + 1]));
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Adicionar proprietário
          </Button>
        )}
        {total >= MAX_OWNERS && (
          <p className="text-xs text-muted-foreground">Limite de {MAX_OWNERS} proprietários.</p>
        )}
      </CardContent>
    </Card>
  );
}
