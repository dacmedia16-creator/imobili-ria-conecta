import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { money, dateBR } from "@/components/vendas/shared";
import { COMISSAO_PAPEIS } from "@/lib/status";
import { agruparComissoes } from "@/lib/financeiro-dashboard-calc";
import type { AgrupamentoComissao, ComissaoCalculada } from "@/lib/financeiro-dashboard-types";

const PAPEL_LABEL: Record<string, string> = Object.fromEntries(
  COMISSAO_PAPEIS.map((p) => [p.key, p.label]),
);

const AGRUPAMENTO_LABEL: Record<AgrupamentoComissao, string> = {
  beneficiario: "Beneficiário",
  gestor: "Gestor",
  equipe: "Equipe",
  papel: "Papel",
  mes: "Mês",
  geral: "Geral",
};

const SITUACAO_RECEBIMENTO_LABEL = {
  nao_recebido: "Não recebido",
  parcial: "Parcial",
  recebido: "Recebido",
} as const;
const SITUACAO_RECEBIMENTO_TONE = {
  nao_recebido: "text-muted-foreground",
  parcial: "text-amber-700 dark:text-amber-400",
  recebido: "text-emerald-700 dark:text-emerald-400",
} as const;

export function ComissoesCalculadasTable({ rows }: { rows: ComissaoCalculada[] }) {
  const [agrupamento, setAgrupamento] = useState<AgrupamentoComissao>("beneficiario");
  const grupos = agruparComissoes(rows, agrupamento);
  const total = rows.reduce((s, r) => s + r.valor, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">Agrupar por</Label>
          <Select
            value={agrupamento}
            onValueChange={(v) => setAgrupamento(v as AgrupamentoComissao)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AGRUPAMENTO_LABEL) as AgrupamentoComissao[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {AGRUPAMENTO_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">
          Total geral: <span className="font-semibold text-foreground">{money(total)}</span> —
          competência, não pagamento
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{AGRUPAMENTO_LABEL[agrupamento]}</TableHead>
            <TableHead>Qtd.</TableHead>
            <TableHead>Valor calculado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grupos.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma comissão calculada no filtro atual.
              </TableCell>
            </TableRow>
          )}
          {grupos.map((g) => (
            <TableRow key={g.chave}>
              <TableCell className="font-medium">
                {agrupamento === "papel" ? (PAPEL_LABEL[g.label] ?? g.label) : g.label}
              </TableCell>
              <TableCell className="text-muted-foreground">{g.quantidade}</TableCell>
              <TableCell className="font-semibold">{money(g.valorTotal)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Imóvel</TableHead>
              <TableHead>Efetivação</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Beneficiário</TableHead>
              <TableHead>Equipe</TableHead>
              <TableHead>Gestor</TableHead>
              <TableHead>%</TableHead>
              <TableHead>Valor calculado</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Recebimento da venda</TableHead>
              <TableHead>Divergência</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma comissão calculada no filtro atual.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  <Link to="/vendas/$id" params={{ id: r.saleId }} className="hover:underline">
                    {r.imovelLabel}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {r.dataEfetivacao ? dateBR(r.dataEfetivacao) : "—"}
                </TableCell>
                <TableCell>{PAPEL_LABEL[r.papel] ?? r.papel}</TableCell>
                <TableCell
                  className={r.semVinculoUsuario ? "text-amber-700 dark:text-amber-400" : ""}
                >
                  {r.beneficiarioNome ?? "—"}
                  {r.semVinculoUsuario && <span className="ml-1 text-xs">(sem vínculo)</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">{r.teamNome ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.gestorNome ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {r.percentual != null ? `${r.percentual}%` : "—"}
                </TableCell>
                <TableCell className="font-medium">{money(r.valor)}</TableCell>
                <TableCell>
                  <Badge variant={r.origem === "manual" ? "outline" : "secondary"}>
                    {r.origem === "manual" ? "Ajuste manual" : "Automática"}
                  </Badge>
                </TableCell>
                <TableCell className={SITUACAO_RECEBIMENTO_TONE[r.situacaoRecebimentoVenda]}>
                  {SITUACAO_RECEBIMENTO_LABEL[r.situacaoRecebimentoVenda]}
                </TableCell>
                <TableCell>
                  {r.semVinculoUsuario ? (
                    <span className="text-amber-700 dark:text-amber-400">Sim</span>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
