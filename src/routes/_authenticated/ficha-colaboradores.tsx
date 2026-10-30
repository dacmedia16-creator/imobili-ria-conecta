import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FileDown, FileSpreadsheet, HeartPulse, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL } from "@/lib/auth";
import { EmptyState, ListSkeleton, PageHeader, Pill } from "@/components/visual/base";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadCurrentAgencyBrand, logoForPdf } from "@/lib/agency-brand";
import {
  COLUNAS_EXPORT,
  MESES,
  NAO_INFORMADO,
  PENDENCIA_LABEL,
  TODOS,
  dataBr,
  dataHoraSp,
  descreverFiltros,
  filhosComFaixas,
  filtrarColaboradores,
  filtrosVazios,
  inputSpParaIso,
  isoParaInputSp,
  linhaExport,
  opcoesDistintas,
  rotuloPapeis,
  textoPendencias,
  type Colaborador,
  type FiltrosFicha,
} from "@/lib/ficha-colaborador";
import {
  listarFichasColaboradores,
  podeVerFichasColaboradores,
  registrarExportacaoFichas,
  salvarPrazoFicha,
} from "@/lib/ficha-colaborador-db";
import { TIPO_XLSX, baixarArquivo, gerarXlsx } from "@/lib/xlsx-simples";
import { buildFichasPdf, fichasPdfFileName } from "@/lib/ficha-colaborador-pdf";

export const Route = createFileRoute("/_authenticated/ficha-colaboradores")({
  head: () => ({ meta: [{ title: "Ficha dos colaboradores" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/dashboard" });
    // O banco decide (staff/admin/administrador principal da imobiliária; nunca "Entrar como").
    if (!(await podeVerFichasColaboradores())) throw redirect({ to: "/dashboard" });
  },
  component: FichaColaboradoresPage,
});

const LABELS = ROLE_LABEL as Record<string, string>;

function FichaColaboradoresPage() {
  const [lista, setLista] = useState<Colaborador[] | null>(null);
  const [prazo, setPrazo] = useState<string>("");
  const [erro, setErro] = useState<string | null>(null);
  const [f, setF] = useState<FiltrosFicha>(filtrosVazios);
  const [exportando, setExportando] = useState<"excel" | "pdf" | null>(null);

  const carregar = () => {
    setErro(null);
    listarFichasColaboradores()
      .then((r) => {
        setLista(r.colaboradores);
        setPrazo(r.obrigatoria_a_partir_de);
      })
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : "Erro ao carregar."));
  };
  useEffect(carregar, []);

  const filtrada = useMemo(() => (lista ? filtrarColaboradores(lista, f) : []), [lista, f]);
  const op = useMemo(() => {
    const l = lista ?? [];
    return {
      planos: opcoesDistintas(l.map((c) => c.plano_saude)),
      religioes: opcoesDistintas(l.map((c) => c.religiao)),
      hospitais: opcoesDistintas(l.map((c) => c.hospital_preferencia)),
      equipes: opcoesDistintas(l.flatMap((c) => c.equipes)),
      papeis: [...new Set(l.flatMap((c) => c.papeis))].sort((a, b) =>
        (LABELS[a] ?? a).localeCompare(LABELS[b] ?? b, "pt-BR"),
      ),
    };
  }, [lista]);
  const set = <K extends keyof FiltrosFicha>(k: K, v: FiltrosFicha[K]) =>
    setF((x) => ({ ...x, [k]: v }));
  const completas = (lista ?? []).filter((c) => c.completa).length;
  const cadastroPendente = (lista ?? []).filter((c) => c.cadastro_pendente.length > 0).length;

  const exportar = async (formato: "excel" | "pdf") => {
    if (!filtrada.length) {
      toast.error("Nenhum colaborador no filtro para exportar.");
      return;
    }
    setExportando(formato);
    try {
      // Registra antes de gerar: se o log falhar, não exporta (exigência de rastreio).
      await registrarExportacaoFichas(formato, filtrada.length);
      const hoje = new Date();
      if (formato === "excel") {
        const bytes = gerarXlsx(
          "Colaboradores",
          [...COLUNAS_EXPORT],
          filtrada.map((c) => linhaExport(c, LABELS)),
        );
        const p = (n: number) => String(n).padStart(2, "0");
        baixarArquivo(
          bytes,
          `ficha-colaboradores-${hoje.getFullYear()}-${p(hoje.getMonth() + 1)}-${p(hoje.getDate())}.xlsx`,
          TIPO_XLSX,
        );
      } else {
        const brand = await loadCurrentAgencyBrand();
        const logo = await logoForPdf(brand?.pdfLogoUrl ?? null);
        const bytes = await buildFichasPdf({
          colaboradores: filtrada,
          totalImobiliaria: lista?.length ?? 0,
          filtros: descreverFiltros(f, LABELS),
          roleLabels: LABELS,
          agencyName: brand?.nome ?? null,
          logoPng: logo,
          issuedAt: hoje,
        });
        baixarArquivo(bytes, fichasPdfFileName(hoje), "application/pdf");
      }
      toast.success("Arquivo gerado. Dados pessoais: guarde e compartilhe com cuidado.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Não foi possível exportar.");
    } finally {
      setExportando(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={HeartPulse}
        title="Ficha dos colaboradores"
        description="Dados pessoais e de emergência de quem usa o sistema. Visível só para staff e administração desta imobiliária."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => exportar("excel")}
              disabled={!lista || exportando !== null}
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              {exportando === "excel" ? "Gerando…" : "Excel"}
            </Button>
            <Button onClick={() => exportar("pdf")} disabled={!lista || exportando !== null}>
              <FileDown className="h-4 w-4" aria-hidden />
              {exportando === "pdf" ? "Gerando…" : "PDF"}
            </Button>
          </>
        }
      />

      {erro && (
        <EmptyState action={<Button onClick={carregar}>Tentar de novo</Button>}>{erro}</EmptyState>
      )}
      {!erro && !lista && <ListSkeleton />}

      {lista && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Resumo rotulo="Colaboradores" valor={lista.length} />
            <Resumo rotulo="Fichas completas" valor={completas} cor="text-green-600" />
            <Resumo rotulo="Pendentes" valor={lista.length - completas} cor="text-red-600" />
            <Resumo rotulo="Cadastro pendente" valor={cadastroPendente} cor="text-amber-600" />
            <Resumo rotulo="No filtro" valor={filtrada.length} />
          </div>

          <PrazoCard prazo={prazo} onSalvo={setPrazo} />

          <Card>
            <CardContent className="grid grid-cols-1 gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
              <Filtro id="ff-busca" label="Buscar nome ou e-mail">
                <Input
                  id="ff-busca"
                  value={f.busca}
                  onChange={(e) => set("busca", e.target.value)}
                />
              </Filtro>
              <Filtro id="ff-mes-de" label="Aniversário de (mês)">
                <Sel
                  id="ff-mes-de"
                  value={f.mesDe == null ? TODOS : String(f.mesDe)}
                  onChange={(v) => set("mesDe", v === TODOS ? null : Number(v))}
                  opcoes={MESES.map((m, i) => [String(i + 1), m])}
                />
              </Filtro>
              <Filtro id="ff-mes-ate" label="Aniversário até (mês)">
                <Sel
                  id="ff-mes-ate"
                  value={f.mesAte == null ? TODOS : String(f.mesAte)}
                  onChange={(v) => set("mesAte", v === TODOS ? null : Number(v))}
                  opcoes={MESES.map((m, i) => [String(i + 1), m])}
                />
              </Filtro>
              <Filtro id="ff-situacao" label="Ficha">
                <Sel
                  id="ff-situacao"
                  value={f.situacao}
                  onChange={(v) => set("situacao", v as FiltrosFicha["situacao"])}
                  opcoes={[
                    ["completa", "Completa"],
                    ["pendente", "Pendente"],
                  ]}
                />
              </Filtro>
              <Filtro id="ff-cadastro" label="Cadastro pendente">
                <Sel
                  id="ff-cadastro"
                  value={f.cadastro}
                  onChange={(v) => set("cadastro", v as FiltrosFicha["cadastro"])}
                  opcoes={[
                    ["pendente", "Com pendência"],
                    ["completo", "Cadastro completo"],
                    ...Object.entries(PENDENCIA_LABEL).map(
                      ([k, l]) => [k, `Falta: ${l}`] as [string, string],
                    ),
                  ]}
                />
              </Filtro>
              <Filtro id="ff-tem-plano" label="Tem plano de saúde">
                <Sel
                  id="ff-tem-plano"
                  value={f.temPlano}
                  onChange={(v) => set("temPlano", v as FiltrosFicha["temPlano"])}
                  opcoes={[
                    ["sim", "Sim"],
                    ["nao", "Não"],
                  ]}
                />
              </Filtro>
              <Filtro id="ff-plano" label="Qual plano">
                <Sel
                  id="ff-plano"
                  value={f.plano}
                  onChange={(v) => set("plano", v)}
                  opcoes={op.planos.map((p) => [p, p])}
                />
              </Filtro>
              <Filtro id="ff-filhos" label="Nº de filhos">
                <Sel
                  id="ff-filhos"
                  value={f.filhos}
                  onChange={(v) => set("filhos", v)}
                  opcoes={[
                    ["0", "0"],
                    ["1", "1"],
                    ["2", "2"],
                    ["3+", "3 ou mais"],
                    [NAO_INFORMADO, "Não informado"],
                  ]}
                />
              </Filtro>
              <Filtro id="ff-religiao" label="Religião">
                <Sel
                  id="ff-religiao"
                  value={f.religiao}
                  onChange={(v) => set("religiao", v)}
                  opcoes={[
                    ...op.religioes.map((r) => [r, r] as [string, string]),
                    [NAO_INFORMADO, "Não informada"],
                  ]}
                />
              </Filtro>
              <Filtro id="ff-hospital" label="Hospital">
                <Sel
                  id="ff-hospital"
                  value={f.hospital}
                  onChange={(v) => set("hospital", v)}
                  opcoes={op.hospitais.map((h) => [h, h])}
                />
              </Filtro>
              <Filtro id="ff-papel" label="Papel">
                <Sel
                  id="ff-papel"
                  value={f.papel}
                  onChange={(v) => set("papel", v)}
                  opcoes={op.papeis.map((p) => [p, LABELS[p] ?? p])}
                />
              </Filtro>
              <Filtro id="ff-equipe" label="Equipe">
                <Sel
                  id="ff-equipe"
                  value={f.equipe}
                  onChange={(v) => set("equipe", v)}
                  opcoes={op.equipes.map((e) => [e, e])}
                />
              </Filtro>
              <div className="flex items-end">
                <Button variant="ghost" onClick={() => setF(filtrosVazios())} className="w-full">
                  <RotateCcw className="h-4 w-4" aria-hidden /> Limpar filtros
                </Button>
              </div>
            </CardContent>
          </Card>

          {filtrada.length === 0 ? (
            <EmptyState>Nenhum colaborador com esse filtro.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card" data-testid="ficha-tabela">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    {[
                      "Nome",
                      "Papel / Equipe",
                      "Nascimento",
                      "Ficha",
                      "Cadastro pendente",
                      "Filhos",
                      "Plano de saúde",
                      "Hospital",
                      "Contato de emergência",
                      "Religião",
                    ].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtrada.map((c) => (
                    <tr key={c.user_id} className="border-t align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">{c.nome}</div>
                        <div className="text-xs text-muted-foreground">{c.email}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{rotuloPapeis(c.papeis, LABELS)}</div>
                        <div className="text-xs text-muted-foreground">{c.equipes.join(", ")}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {dataBr(c.data_nascimento) || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {c.completa ? (
                          <Pill tom="green">Completa</Pill>
                        ) : (
                          <Pill tom="red">Pendente</Pill>
                        )}
                      </td>
                      <td className="px-3 py-2" data-testid="cadastro-pendente-celula">
                        {c.cadastro_pendente.length ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            {textoPendencias(c.cadastro_pendente)}
                          </span>
                        ) : (
                          <Pill tom="green">Completo</Pill>
                        )}
                      </td>
                      <td className="px-3 py-2">{filhosComFaixas(c) || "—"}</td>
                      <td className="px-3 py-2">
                        {c.tem_plano_saude == null
                          ? "—"
                          : c.tem_plano_saude
                            ? c.plano_saude
                            : "Não tem"}
                      </td>
                      <td className="px-3 py-2">{c.hospital_preferencia ?? "—"}</td>
                      <td className="px-3 py-2">
                        {c.emergencia_nome ? (
                          <>
                            <div>
                              {c.emergencia_nome}
                              {c.emergencia_parentesco ? ` (${c.emergencia_parentesco})` : ""}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {c.emergencia_telefone}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">{c.religiao ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Resumo({ rotulo, valor, cor }: { rotulo: string; valor: number; cor?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className={`text-2xl font-semibold ${cor ?? ""}`}>{valor}</div>
    </div>
  );
}

function PrazoCard({ prazo, onSalvo }: { prazo: string; onSalvo: (iso: string) => void }) {
  const [valor, setValor] = useState(() => isoParaInputSp(prazo));
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setValor(isoParaInputSp(prazo)), [prazo]);
  const salvar = async () => {
    const iso = inputSpParaIso(valor);
    if (!iso) {
      toast.error("Informe data e hora.");
      return;
    }
    setSalvando(true);
    try {
      onSalvo(await salvarPrazoFicha(iso));
      toast.success("Prazo atualizado.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 pt-6 text-sm">
        <div className="space-y-1.5">
          <Label htmlFor="ff-prazo">Ficha obrigatória a partir de (horário de Brasília)</Label>
          <Input
            id="ff-prazo"
            type="datetime-local"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="w-60"
          />
        </div>
        <Button
          variant="outline"
          onClick={salvar}
          disabled={salvando || valor === isoParaInputSp(prazo)}
        >
          {salvando ? "Salvando…" : "Salvar prazo"}
        </Button>
        <p className="basis-full text-xs text-muted-foreground">
          Até {dataHoraSp(prazo)} a tela aparece ao entrar com “Preencher depois”. Depois disso, só
          libera o sistema quando a pessoa salvar a ficha.
        </p>
      </CardContent>
    </Card>
  );
}

function Filtro({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Sel({
  id,
  value,
  onChange,
  opcoes,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  opcoes: [string, string][];
}) {
  return (
    <select
      id={id}
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value={TODOS}>Todos</option>
      {opcoes.map(([v, t]) => (
        <option key={v} value={v}>
          {t}
        </option>
      ))}
    </select>
  );
}
