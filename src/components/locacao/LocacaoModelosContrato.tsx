import { useCallback, useEffect, useRef, useState } from "react";
import fonteUrl from "@/assets/fonts/DejaVuSans.ttf?url";
import negritoUrl from "@/assets/fonts/DejaVuSans-Bold.ttf?url";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  historicoModeloLocacao, lerModeloLocacao, listarModelosLocacao,
  restaurarModeloLocacao, salvarModeloLocacao,
} from "@/lib/locacao-db";
import { gerarPdfContrato } from "@/lib/locacao-montagem";
import {
  BLOCOS_MODELO, CAMPOS_MODELO, CHAVES_MODELO, limparParagrafos, lerModelo,
  novoIdParagrafo, travadosMudaram, validarModelo, type ChaveModelo, type ModeloContrato,
  type ParagrafoModelo,
} from "@/lib/locacao-modelos";
import { textoTesteModelo } from "@/lib/locacao-modelos-preview";
import { errorMessage } from "@/lib/errors";

const nome = (k: string) => ({
  fiador: "Fiador", caucao_dinheiro: "Caução em dinheiro", caucao_imovel: "Imóvel caucionado",
  seguro_porto: "Porto Seguro", seguro_pottencial: "Pottencial", seguro_tokio: "Tokio Marine",
  seguro_almada: "Almada", loft: "CredPago (Loft)",
} as Record<string, string>)[k] || k;

type Versao = { versao: number; padrao?: boolean; criado_em?: string; autor?: string; nota?: string };

/** Contratos/admin apenas; o banco revalida organização e papel a cada operação. */
export function LocacaoModelosContrato() {
  const [lista, setLista] = useState<ModeloContrato[]>([]);
  const [chave, setChave] = useState<ChaveModelo>("fiador");
  const [modelo, setModelo] = useState<ModeloContrato | null>(null);
  const [ps, setPs] = useState<ParagrafoModelo[]>([]);
  const [historico, setHistorico] = useState<Versao[]>([]);
  const [nota, setNota] = useState("");
  const [tipoPreview, setTipoPreview] = useState<"residencial" | "comercial">("residencial");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [ativo, setAtivo] = useState<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const dirty = modelo ? JSON.stringify(limparParagrafos(ps)) !== JSON.stringify(limparParagrafos(modelo.paragrafos)) : false;
  const erros = modelo && dirty ? validarModelo(chave, ps) : [];

  const carregar = useCallback(async (k: ChaveModelo) => {
    setErro("");
    const [res, h] = await Promise.all([lerModeloLocacao(k), historicoModeloLocacao(k)]);
    const lido = lerModelo(res);
    if (!lido) throw new Error("Modelo indisponível.");
    setModelo(lido);
    setPs(lido.paragrafos);
    setHistorico(Array.isArray(h) ? h as Versao[] : []);
    setNota("");
    setAtivo(null);
  }, []);
  useEffect(() => {
    let vivo = true;
    void listarModelosLocacao().then((raw) => {
      if (vivo) setLista((Array.isArray(raw) ? raw : []).map(lerModelo).filter((x): x is ModeloContrato => !!x));
    }).catch((e) => { if (vivo) setErro(errorMessage(e, "Não foi possível listar os modelos.")); });
    return () => { vivo = false; };
  }, []);
  useEffect(() => {
    let vivo = true;
    setModelo(null);
    void carregar(chave).catch((e) => { if (vivo) setErro(errorMessage(e, "Não foi possível carregar este modelo.")); });
    return () => { vivo = false; };
  }, [carregar, chave]);

  const trocar = (k: ChaveModelo) => {
    if (k === chave) return;
    if (dirty && !window.confirm("Alterações não salvas serão perdidas. Trocar de modelo?")) return;
    setChave(k);
  };
  const editar = (i: number, t: string) => setPs((old) => old.map((p, j) => j === i ? { ...p, t } : p));
  const inserir = (texto: string) => {
    const index = ativo;
    if (index == null || !ps[index]) return;
    const node = area.current;
    const start = node?.selectionStart ?? ps[index].t.length;
    const end = node?.selectionEnd ?? start;
    editar(index, ps[index].t.slice(0, start) + texto + ps[index].t.slice(end));
    requestAnimationFrame(() => { node?.focus(); node?.setSelectionRange(start + texto.length, start + texto.length); });
  };
  const movimentar = (i: number, delta: number) => {
    const next = i + delta;
    if (next < 0 || next >= ps.length) return;
    setPs((old) => { const arr = [...old]; [arr[i], arr[next]] = [arr[next], arr[i]]; return arr; });
    setAtivo(next);
  };
  const adicionar = () => {
    const index = ativo == null ? ps.length : ativo + 1;
    setPs((old) => { const arr = [...old]; arr.splice(index, 0, { id: novoIdParagrafo(old), t: "Nova cláusula:" }); return arr; });
    setAtivo(index);
  };
  const salvar = async () => {
    if (!modelo || !dirty || erros.length) return;
    const confirma = travadosMudaram(modelo.paragrafos, ps);
    if (confirma && !window.confirm("ATENÇÃO: texto exigido pela seguradora/Loft foi alterado ou removido. Confirma que a nova redação veio da própria seguradora/Loft?")) return;
    setBusy(true);
    try {
      // Evita substituir silenciosamente outra edição já salva enquanto esta tela ficou aberta.
      const vigente = lerModelo(await lerModeloLocacao(chave));
      if (vigente?.versao !== modelo.versao) throw new Error("Há versão nova deste modelo. Recarregue antes de salvar para não sobrescrever outra edição.");
      await salvarModeloLocacao(chave, limparParagrafos(ps), nota, confirma);
      await carregar(chave);
      toast.success("Modelo salvo em nova versão. Minutas já guardadas não mudaram.");
    } catch (e) { toast.error(errorMessage(e, "Falha ao salvar o modelo.")); }
    finally { setBusy(false); }
  };
  const restaurar = async (versao: number) => {
    if (!modelo || dirty && !window.confirm("As alterações não salvas serão perdidas. Continuar?")) return;
    const anterior = lerModelo(await lerModeloLocacao(chave, versao));
    if (!anterior) return;
    const confirma = travadosMudaram(modelo.paragrafos, anterior.paragrafos);
    if (!window.confirm(`Restaurar ${versao ? `v${versao}` : "padrão"}? Será criada uma nova versão; as minutas já geradas não mudam.`)) return;
    if (confirma && !window.confirm("O texto exigido pela seguradora/Loft muda. Confirma que esta versão foi conferida com a própria seguradora/Loft?")) return;
    setBusy(true);
    try {
      await restaurarModeloLocacao(chave, versao, confirma);
      await carregar(chave);
      toast.success("Versão restaurada como nova versão.");
    } catch (e) { toast.error(errorMessage(e, "Não foi possível restaurar.")); }
    finally { setBusy(false); }
  };
  const preview = async () => {
    if (!modelo || erros.length) return;
    setBusy(true);
    try {
      const atual = { ...modelo, paragrafos: ps };
      const paragrafos = textoTesteModelo(atual, tipoPreview);
      const [f, n] = await Promise.all([fetch(fonteUrl), fetch(negritoUrl)]);
      if (!f.ok || !n.ok) throw new Error("Fonte do PDF indisponível.");
      const bytes = await gerarPdfContrato(paragrafos, await f.arrayBuffer(), { negrito: await n.arrayBuffer() });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url; link.download = `teste-${chave}-${tipoPreview}-FICTICIO.pdf`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast.error(errorMessage(e, "Não foi possível pré-visualizar.")); }
    finally { setBusy(false); }
  };

  return (
    <Card data-testid="locacao-modelos-editor">
      <CardHeader><CardTitle className="text-base">Modelos de contrato</CardTitle>
        <p className="text-sm text-muted-foreground">Esta imobiliária parte dos modelos padrão. Edite o texto, inclua, remova ou reordene cláusulas. Cada salvamento cria uma versão; minutas anteriores permanecem iguais.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <label className="block text-sm">Garantia
          <select aria-label="Modelo de contrato" value={chave} disabled={busy} onChange={(e) => trocar(e.target.value as ChaveModelo)} className="mt-1 h-9 w-full rounded-md border bg-background px-3">
            {CHAVES_MODELO.map((k) => <option key={k} value={k}>{nome(k)} {lista.find((m) => m.chave === k)?.versao ? `(v${lista.find((m) => m.chave === k)?.versao})` : ""}</option>)}
          </select>
        </label>
        {!modelo ? <p>Carregando modelo…</p> : <>
          <p className="text-sm">{nome(chave)} · {modelo.versao ? `versão ${modelo.versao} desta imobiliária` : "padrão do sistema"} · {modelo.paragrafos.length} parágrafos</p>
          <p className="text-xs text-amber-700">Os parágrafos “texto exigido pela seguradora/Loft” entram sem troca de gênero; confirme a fonte antes de alterá-los. A Porto usa IGP-M no texto original.</p>
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">Campos [ ] disponíveis (clique para inserir no parágrafo selecionado)</p>
            <div className="flex max-h-32 flex-wrap gap-1 overflow-auto py-2">{CAMPOS_MODELO.map((f) => <Button key={f.k} size="sm" variant="outline" type="button" title={f.label} disabled={ativo == null} onClick={() => inserir(`[${f.k}]`)}>[{f.k}]</Button>)}</div>
            <p className="font-medium">Blocos automáticos (um por parágrafo, alguns obrigatórios)</p>
            <div className="flex flex-wrap gap-1 py-2">{BLOCOS_MODELO.map((f) => <Button key={f.k} size="sm" variant="outline" type="button" title={f.label} disabled={ativo == null} onClick={() => inserir(`[[${f.k}]]`)}>[[{f.k}]]</Button>)}</div>
          </div>
          <div className="max-h-[570px] space-y-3 overflow-y-auto rounded-md border p-2">
            {ps.map((p, i) => <div key={p.id} className={`rounded border p-2 ${ativo === i ? "border-primary" : ""}`}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                <b>{i + 1}. {p.id}</b>
                {p.trava && <span className="rounded bg-amber-100 px-2 text-amber-900">Texto exigido pela seguradora/Loft</span>}
                {p.dest && <span>Somente {p.dest}</span>}
                {p.cond && <span>Condicional: isenção no 12º mês</span>}
                {p.adaptado && <span>Adaptado do residencial</span>}
                <Button size="sm" variant="outline" disabled={busy || i === 0} onClick={() => movimentar(i, -1)}>↑</Button>
                <Button size="sm" variant="outline" disabled={busy || i === ps.length - 1} onClick={() => movimentar(i, 1)}>↓</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { setPs((old) => old.filter((_, j) => j !== i)); setAtivo(null); }}>Remover</Button>
              </div>
              <Textarea ref={ativo === i ? area : undefined} aria-label={`Cláusula ${i + 1}`} rows={Math.min(7, Math.max(2, Math.ceil(p.t.length / 90)))} value={p.t} disabled={busy} onFocus={() => setAtivo(i)} onChange={(e) => editar(i, e.target.value)} />
            </div>)}
          </div>
          <Button type="button" variant="outline" disabled={busy} onClick={adicionar}>+ Incluir cláusula</Button>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">PDF fictício: <select value={tipoPreview} onChange={(e) => setTipoPreview(e.target.value as "residencial" | "comercial")} className="rounded border bg-background p-1"><option value="residencial">Residencial</option><option value="comercial">Comercial</option></select></label>
            <Button type="button" variant="outline" disabled={busy || erros.length > 0} onClick={() => void preview()}>Pré-visualizar PDF de teste</Button>
          </div>
          {erros.length > 0 && <div role="alert" className="rounded border border-destructive p-2 text-sm text-destructive">Antes de salvar: {erros.join("; ")}</div>}
          <Input aria-label="Nota desta versão" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Nota da alteração (opcional)" />
          <Button type="button" disabled={busy || !dirty || erros.length > 0} onClick={() => void salvar()}>Salvar nova versão</Button>
          <div className="space-y-2 border-t pt-3"><h4 className="font-medium">Histórico (versões anteriores)</h4>
            {historico.map((h) => <div key={`${h.padrao}-${h.versao}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span>{h.padrao ? "Padrão do sistema" : `v${h.versao}`} · {h.criado_em ? new Date(h.criado_em).toLocaleString("pt-BR") : ""} · {h.autor || "sistema"}{h.nota ? ` · ${h.nota}` : ""}</span>
              {!(h.versao === modelo.versao && h.padrao === modelo.padrao) && <Button variant="outline" size="sm" disabled={busy} onClick={() => void restaurar(h.versao)}>Restaurar como nova versão</Button>}
            </div>)}
          </div>
        </>}
      </CardContent>
    </Card>
  );
}
