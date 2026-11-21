// Ficha de moradores da locação (t_40cff7e4). Um bloco por morador (nome, CPF, nascimento, e-mail, telefone), com
// adicionar/remover. Maior de 18 gera "Cópia do RG — <nome>" obrigatória no checklist do locatário (o banco calcula).
// Imóvel de condomínio: botão "Pacote para a administradora" (PDF único; o corretor baixa e manda ele mesmo).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage } from "@/lib/errors";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { baixarPacote, lerMoradores, salvarMoradores } from "@/lib/locacao-db";
import {
  AVISO_LGPD_MORADORES,
  MAX_MORADORES,
  errosLista,
  errosMorador,
  itemRgMorador,
  moradorAdulto,
  moradorVazio,
  type Morador,
} from "@/lib/locacao-moradores";

const CAMPOS = [
  ["nome", "Nome completo", "text"],
  ["cpf", "CPF", "text"],
  ["nascimento", "Data de nascimento", "date"],
  ["email", "E-mail", "email"],
  ["telefone", "Telefone (com DDD)", "tel"],
] as const;

function quando(iso: string) {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";
}

export function LocacaoMoradores({
  id,
  editavel,
  condominio,
  documentos,
  textoAntigo,
  recarregar,
}: {
  id: string;
  editavel: boolean;
  condominio: boolean;
  /** Documentos anexados (item) — para mostrar RG anexado/pendente. */
  documentos: { item: string }[];
  /** Texto livre de moradores de locação antiga (antes da ficha), só para referência. */
  textoAntigo: string;
  recarregar: () => Promise<void>;
}) {
  const hoje = hojeSaoPaulo();
  const [pessoas, setPessoas] = useState<Morador[] | null>(null);
  const [salvas, setSalvas] = useState<Morador[]>([]);
  const [ficha, setFicha] = useState(false);
  const [obrigatoria, setObrigatoria] = useState(true);
  // Data para contar os 18 anos: hoje na Documentação; congelada pelo banco quando a locação sai dela.
  const [referencia, setReferencia] = useState("");
  const [downloads, setDownloads] = useState<{ em: string; por: string | null }[]>([]);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [baixando, setBaixando] = useState(false);

  const carregar = async () => {
    const r = await lerMoradores(id);
    setPessoas(r.pessoas);
    setSalvas(r.pessoas);
    setFicha(r.ficha);
    setObrigatoria(r.obrigatoria);
    setReferencia(r.congelada ? r.referencia : "");
    setDownloads(r.downloads);
    setErro("");
  };
  useEffect(() => {
    let vivo = true;
    lerMoradores(id)
      .then((r) => {
        if (!vivo) return;
        setPessoas(r.pessoas);
        setSalvas(r.pessoas);
        setFicha(r.ficha);
        setObrigatoria(r.obrigatoria);
        setReferencia(r.congelada ? r.referencia : "");
        setDownloads(r.downloads);
      })
      .catch((e) => vivo && setErro(errorMessage(e, "Ficha de moradores indisponível.")));
    return () => {
      vivo = false;
    };
  }, [id]);

  const sujo = JSON.stringify(pessoas) !== JSON.stringify(salvas);
  const lista = pessoas ?? [];
  const problemas = [
    ...lista.flatMap((p, i) => {
      const e = errosMorador(p, hoje);
      return e.length ? [`Morador ${i + 1}: ${e.join(", ")}`] : [];
    }),
    ...errosLista(lista),
  ];
  const mudar = (pid: string, campo: keyof Morador, v: string) =>
    setPessoas((xs) => (xs ?? []).map((p) => (p.id === pid ? { ...p, [campo]: v } : p)));

  const salvar = async () => {
    if (problemas.length) {
      toast.error(`Confira: ${problemas.join("; ")}`);
      return;
    }
    setSalvando(true);
    try {
      await salvarMoradores(id, lista);
      toast.success("Ficha de moradores salva. O contrato recebe nome e CPF de cada morador.");
      await carregar();
      await recarregar();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar a ficha de moradores."));
    } finally {
      setSalvando(false);
    }
  };

  const pacote = async () => {
    setBaixando(true);
    try {
      await baixarPacote(id);
      toast.success("Pacote baixado. Envie você mesmo à administradora do condomínio.");
      await carregar();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível gerar o pacote."));
    } finally {
      setBaixando(false);
    }
  };

  const ref = referencia || hoje;
  const rgsPendentes = salvas.filter(
    (p) =>
      moradorAdulto(p.nascimento, ref) && !documentos.some((d) => d.item === itemRgMorador(p.nome)),
  );

  return (
    <Card className="lg:col-span-2" data-testid="locacao-moradores">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4" /> Ficha dos moradores
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p
          className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100"
          data-testid="moradores-aviso-lgpd"
        >
          {AVISO_LGPD_MORADORES}
        </p>
        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}
        {!pessoas && !erro && (
          <p className="text-sm text-muted-foreground">Carregando moradores…</p>
        )}
        {pessoas && !ficha && !obrigatoria && textoAntigo.trim() && (
          <p className="text-xs text-muted-foreground" data-testid="moradores-texto-antigo">
            Locação aberta antes da ficha: o contrato usa o texto já digitado (
            {textoAntigo.split("\n").length} linha(s)). Preencher a ficha passa a valer para o
            contrato e para o pacote.
          </p>
        )}
        {lista.map((p, i) => {
          const adulto = moradorAdulto(p.nascimento, ref);
          const anexado = documentos.some((d) => d.item === itemRgMorador(p.nome));
          return (
            <div key={p.id} className="space-y-2 rounded-md border p-3" data-testid="morador-bloco">
              <div className="flex items-center justify-between gap-2">
                <b className="text-sm">Morador {i + 1}</b>
                {editavel && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={salvando}
                    onClick={() => setPessoas((xs) => (xs ?? []).filter((x) => x.id !== p.id))}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Remover
                  </Button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CAMPOS.map(([campo, rotulo, tipo]) => (
                  <div key={campo} className="space-y-1">
                    <Label htmlFor={`morador-${p.id}-${campo}`} className="text-xs">
                      {rotulo}
                    </Label>
                    <Input
                      id={`morador-${p.id}-${campo}`}
                      type={tipo}
                      value={p[campo]}
                      max={tipo === "date" ? hoje : undefined}
                      maxLength={campo === "email" ? 200 : campo === "nome" ? 120 : 20}
                      inputMode={campo === "cpf" ? "numeric" : undefined}
                      disabled={!editavel || salvando}
                      onChange={(e) => mudar(p.id, campo, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              {p.nascimento && (
                <p className="text-xs" data-testid="morador-rg">
                  {adulto ? (
                    <span className={anexado ? "text-emerald-700" : "text-amber-700"}>
                      Maior de 18: cópia do RG obrigatória —{" "}
                      {anexado ? "anexada" : "anexe no checklist do locatário"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Menor de 18: RG não exigido.</span>
                  )}
                </p>
              )}
            </div>
          );
        })}
        {pessoas && !lista.length && (
          <p className="text-xs text-amber-700">
            Cadastre pelo menos um morador (o locatário também, se for morar).
          </p>
        )}
        {editavel && pessoas && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={salvando || lista.length >= MAX_MORADORES}
              onClick={() => setPessoas((xs) => [...(xs ?? []), moradorVazio(crypto.randomUUID())])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar morador
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={salvando || !sujo}
              onClick={() => void salvar()}
            >
              {salvando ? "Salvando…" : "Salvar moradores"}
            </Button>
            {sujo && problemas.length > 0 && (
              <span className="text-xs text-destructive">Falta: {problemas.join("; ")}</span>
            )}
          </div>
        )}
        {condominio && (
          <div className="space-y-1 border-t pt-3" data-testid="pacote-administradora">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={baixando || sujo || !salvas.length || rgsPendentes.length > 0}
                onClick={() => void pacote()}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                {baixando ? "Gerando…" : "Pacote para a administradora"}
              </Button>
              <span className="text-xs text-muted-foreground">
                PDF único: locatário, moradores, RGs, endereço/unidade e data de entrada. Você baixa
                e envia.
              </span>
            </div>
            {rgsPendentes.length > 0 && (
              <p className="text-xs text-amber-700">
                Para liberar o pacote, anexe:{" "}
                {rgsPendentes.map((p) => itemRgMorador(p.nome)).join("; ")}.
              </p>
            )}
            {downloads.length > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="pacote-downloads">
                Baixado:{" "}
                {downloads.map((d) => `${quando(d.em)}${d.por ? ` por ${d.por}` : ""}`).join(" · ")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
