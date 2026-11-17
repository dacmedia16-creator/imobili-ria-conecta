// Minuta anexada e versionada + registro de andamento (t_f8f83f9f, Pacote 1 do plano t_55cd3848).
// O banco (migration 20261130120000) repete toda regra: só o setor de contratos anexa e registra andamento; quem vê a
// locação baixa; "enviar ao corretor" e "preparar assinatura" recusam sem arquivo.
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/visual/base";
import { errorMessage } from "@/lib/errors";
import {
  AGUARDANDO_LABEL,
  GARANTIA_LABEL,
  temModeloMinuta,
  type Aguardando,
  type Andamento,
  type LocacaoDetalhe,
  type MinutaVersao,
} from "@/lib/locacao";
import { guardarMinuta, registrarAndamento, resolverAndamento } from "@/lib/locacao-db";
import { LocacaoArquivoAcoes } from "./LocacaoArquivoAcoes";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60";

const ORIGEM_LABEL: Record<MinutaVersao["origem"], string> = {
  anexo: "anexada",
  gerada: "gerada pelo modelo",
  externa: "de outra RE/MAX",
};

const quando = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/** Quadro "Minuta": versão atual + histórico; o setor de contratos anexa (PDF/Word). */
export function MinutaArquivos({
  d,
  contratos,
  busy,
  recarregar,
  aviso,
}: {
  d: LocacaoDetalhe;
  contratos: boolean;
  busy: boolean;
  recarregar: () => Promise<void>;
  aviso: (tom: "blue" | "amber" | "red" | "green", c: ReactNode) => ReactNode;
}) {
  const [enviando, setEnviando] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [atual, ...antigas] = d.minutas;
  const editavel = contratos && d.etapa === "minuta";
  const semModelo = !temModeloMinuta(d);
  const anexar = async (f: File | undefined) => {
    if (!f) return;
    setEnviando(true);
    try {
      const v = await guardarMinuta(d.id, f, f.name, "anexo");
      toast.success(`Minuta v${v} guardada. Agora é só enviar ao corretor.`);
      await recarregar();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível guardar a minuta."));
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <section className="space-y-2 rounded-md border p-3" data-testid="locacao-minuta-arquivos">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Minuta (arquivo)</p>
        {atual && (
          <Pill tom="blue">
            versão atual v{atual.versao}
            {d.minuta.versaoEnviada === atual.versao ? " · enviada ao corretor" : ""}
          </Pill>
        )}
      </div>
      {editavel && semModelo && (
        <div data-testid="locacao-minuta-sem-modelo">
          {aviso(
            "amber",
            <>
              <b>
                Ainda não há modelo no sistema para locação {d.tipo} com{" "}
                {GARANTIA_LABEL[d.garantia].toLowerCase()}.
              </b>{" "}
              A minuta <b>não</b> é gerada aqui: faça a minuta fora do sistema e anexe o arquivo
              (PDF ou Word) abaixo. Só depois o envio ao corretor é liberado.
            </>,
          )}
        </div>
      )}
      {!atual ? (
        <p className="text-sm text-muted-foreground" data-testid="locacao-minuta-vazia">
          Nenhum arquivo de minuta guardado ainda.
          {!contratos && " O setor de contratos anexa a minuta e avisa quando enviar."}
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {[atual, ...antigas].map((v, i) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2">
              <b>v{v.versao}</b>
              <span className={i ? "text-muted-foreground" : ""}>
                {v.nomeArquivo} · {ORIGEM_LABEL[v.origem]} · {quando(v.enviadoEm)}
                {v.enviadoPorNome ? ` · ${v.enviadoPorNome}` : ""}
              </span>
              <LocacaoArquivoAcoes tipo="minuta" id={v.id} nome={v.nomeArquivo} />
            </li>
          ))}
        </ul>
      )}
      {editavel && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => void anexar(e.target.files?.[0])}
            data-testid="locacao-minuta-input"
          />
          <Button
            variant="outline"
            disabled={busy || enviando}
            onClick={() => input.current?.click()}
          >
            <FileUp className="mr-1 h-4 w-4" />
            {enviando
              ? "Guardando…"
              : atual
                ? `Anexar nova versão (v${atual.versao + 1})`
                : "Anexar minuta (PDF ou Word)"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Cada arquivo vira uma versão. Uma versão nova precisa ser enviada ao corretor de novo.
          </span>
        </div>
      )}
    </section>
  );
}

/** Registro de andamento: nota livre com "aguardando quem", visível ao corretor, sem mudar a situação. */
export function MinutaAndamentos({
  d,
  contratos,
  souCorretor,
  busy,
  rodar,
}: {
  d: LocacaoDetalhe;
  contratos: boolean;
  souCorretor: boolean;
  busy: boolean;
  rodar: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [texto, setTexto] = useState("");
  const [aguardando, setAguardando] = useState<"" | Aguardando>("");
  const editavel = contratos && (d.etapa === "minuta" || d.etapa === "assinatura");
  const abertas = d.andamentos.filter((a) => a.aguardando && !a.resolvidoEm);
  const outras = d.andamentos.filter((a) => !(a.aguardando && !a.resolvidoEm));
  if (!editavel && d.andamentos.length === 0) return null;
  const podeResolver = (a: Andamento) => contratos || (souCorretor && a.aguardando === "corretor");
  const linha = (a: Andamento) => (
    <li key={a.id} className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-2">
        {a.aguardando ? (
          <Pill tom={a.resolvidoEm ? "green" : "amber"}>
            {a.resolvidoEm ? "resolvido" : `aguardando ${AGUARDANDO_LABEL[a.aguardando]}`}
          </Pill>
        ) : (
          <Pill tom="slate">nota</Pill>
        )}
        <span>{a.texto}</span>
        {a.aguardando && !a.resolvidoEm && podeResolver(a) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={busy}
            onClick={() => void rodar(() => resolverAndamento(a.id), "Marcado como resolvido")}
          >
            marcar resolvido
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {quando(a.criadoEm)}
        {a.criadoPorNome ? ` · ${a.criadoPorNome}` : ""}
        {a.resolvidoEm
          ? ` · resolvido ${quando(a.resolvidoEm)}${a.resolvidoPorNome ? ` por ${a.resolvidoPorNome}` : ""}${a.resolucao ? ` — ${a.resolucao}` : ""}`
          : ""}
      </p>
    </li>
  );
  return (
    <section className="space-y-2 rounded-md border p-3" data-testid="locacao-andamentos">
      <p className="text-sm font-medium">
        Andamento da minuta{" "}
        {abertas.length > 0 && <Pill tom="amber">{abertas.length} em aberto</Pill>}
      </p>
      {abertas.length > 0 && <ul className="space-y-1.5 text-sm">{abertas.map(linha)}</ul>}
      {outras.length > 0 && (
        <details className="text-sm" open={abertas.length === 0}>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Resolvidos e notas ({outras.length})
          </summary>
          <ul className="mt-1 space-y-1.5">{outras.map(linha)}</ul>
        </details>
      )}
      {editavel && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1 space-y-1">
            <Label htmlFor="andamento-texto">Registrar andamento (não muda a situação)</Label>
            <Input
              id="andamento-texto"
              value={texto}
              maxLength={500}
              placeholder="Ex.: aguardando retorno do proprietário sobre a pintura"
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>
          <div className="w-44 space-y-1">
            <Label htmlFor="andamento-quem">Aguardando quem</Label>
            <select
              id="andamento-quem"
              className={SELECT}
              value={aguardando}
              onChange={(e) => setAguardando(e.target.value as "" | Aguardando)}
            >
              <option value="">Ninguém (só nota)</option>
              {(Object.keys(AGUARDANDO_LABEL) as Aguardando[]).map((k) => (
                <option key={k} value={k}>
                  {AGUARDANDO_LABEL[k][0].toUpperCase() + AGUARDANDO_LABEL[k].slice(1)}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            disabled={busy || texto.trim().length < 5}
            onClick={() =>
              void rodar(async () => {
                await registrarAndamento(d.id, texto.trim(), aguardando || null);
                setTexto("");
                setAguardando("");
              }, "Andamento registrado (o corretor vê)")
            }
          >
            Registrar
          </Button>
        </div>
      )}
    </section>
  );
}
