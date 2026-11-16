import { useEffect, useState } from "react";
import fonteUrl from "@/assets/fonts/DejaVuSans.ttf?url";
import negritoUrl from "@/assets/fonts/DejaVuSans-Bold.ttf?url";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { loadCurrentAgencyBrand, logoForPdf } from "@/lib/agency-brand";
import { guardarMinuta, lerMontagem, salvarMontagem } from "@/lib/locacao-db";
import {
  CAMPOS,
  CAMPOS_DOCUMENTO,
  PASSOS,
  camposIniciais,
  dadosContrato,
  faltasMontagem,
  fimPrazo,
  gerarPdfContrato,
  textoContrato,
  modeloDaMontagem,
  chaveModeloLocacao,
  CAMPOS_GARANTIA,
  grupoGarantia,
  type LocacaoBase,
  type Montagem,
} from "@/lib/locacao-montagem";
import { modelosDaGarantia } from "@/lib/locacao-modelos";
import { linhasPessoas, parseSexos } from "@/lib/locacao-concordancia";

export function LocacaoMontarContrato({
  d,
  onGuardada,
}: {
  d: LocacaoBase & { id: string; docsCompleta: boolean };
  /** Chamado depois de "Gerar e guardar" (a tela recarrega as versões da minuta). */
  onGuardada?: () => void | Promise<void>;
}) {
  const [m, setM] = useState<Montagem | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [passo, setPasso] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [erro, setErro] = useState("");
  useEffect(() => {
    if (!d.docsCompleta || modelosDaGarantia(d.garantia).length === 0) return;
    let ativo = true;
    void lerMontagem(d.id)
      .then((raw) => {
        if (!ativo) return;
        const x = raw as Montagem;
        setM(x);
        setValores(camposIniciais(d, x));
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof Error ? e.message : "Montagem indisponível");
      });
    return () => {
      ativo = false;
    };
  }, [d]);
  if (!d.docsCompleta)
    return (
      <p className="rounded-md border p-3 text-sm" data-testid="montagem-travada">
        🔒 Montar contrato travado: documentos obrigatórios pendentes.
      </p>
    );
  // Sem modelo para esta combinação: o aviso claro fica no quadro "Minuta" (anexar a minuta feita por fora).
  if (modelosDaGarantia(d.garantia).length === 0) return null;
  if (erro)
    return (
      <p role="alert" className="text-sm text-destructive">
        {erro}
      </p>
    );
  if (!m) return <p className="text-sm">Carregando montagem…</p>;
  const v = dadosContrato(m, valores);
  const fim = fimPrazo(v.inicio, Number(v.prazo_meses));
  const faltas = faltasMontagem(d, m, valores);
  const chave = chaveModeloLocacao(d, v);
  const modelo = modeloDaMontagem(d, m, valores);
  const garantiaAtiva = chave
    ? grupoGarantia(chave)
    : d.garantia === "seguro_fianca"
      ? "seguro"
      : "";
  const camposGarantiaAtivos = CAMPOS_GARANTIA[garantiaAtiva] ?? [];
  const mudar = (k: string, value: string) => {
    setValores((old) => ({ ...old, [k]: value }));
    setDirty(true);
  };
  const salvar = async () => {
    setBusy(true);
    try {
      await salvarMontagem(d.id, valores);
      const fresh = (await lerMontagem(d.id)) as Montagem;
      setM(fresh);
      setValores(camposIniciais(d, fresh));
      setDirty(false);
      toast.success("Montagem salva. Nenhuma cobrança ou assinatura foi enviada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar montagem");
    } finally {
      setBusy(false);
    }
  };
  const nomePdf = `contrato-${d.codigo.replace(/[^a-zA-Z0-9-]/g, "-")}.pdf`;
  // Revalida a trava no servidor imediatamente antes de gerar e usa somente os dados salvos.
  const montarPdf = async (): Promise<{
    blob: Blob;
    modelo?: { chave: string; versao: number };
  }> => {
    const fresh = (await lerMontagem(d.id)) as Montagem;
    const salvos = camposIniciais(d, fresh);
    const paragrafos = textoContrato(d, fresh, salvos);
    const usado = modeloDaMontagem(d, fresh, salvos);
    const [fonteResposta, negritoResposta, brand] = await Promise.all([
      fetch(fonteUrl),
      fetch(negritoUrl),
      loadCurrentAgencyBrand().catch(() => null),
    ]);
    if (!fonteResposta.ok) throw new Error("Fonte do PDF indisponível");
    const logo = await logoForPdf(brand?.pdfLogoUrl ?? "/remax-logo-transparent.png");
    const bytes = await gerarPdfContrato(paragrafos, await fonteResposta.arrayBuffer(), {
      negrito: negritoResposta.ok ? await negritoResposta.arrayBuffer() : undefined,
      logo,
    });
    return {
      blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      ...(usado ? { modelo: { chave: usado.chave, versao: usado.versao } } : {}),
    };
  };
  const pdf = async () => {
    setBusy(true);
    try {
      const { blob } = await montarPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomePdf.replace(/\.pdf$/, "-conferencia.pdf");
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar PDF");
    } finally {
      setBusy(false);
    }
  };
  const guardar = async () => {
    setBusy(true);
    try {
      const { blob, modelo: versaoModelo } = await montarPdf();
      const v = await guardarMinuta(d.id, blob, nomePdf, "gerada", versaoModelo);
      toast.success(`Minuta v${v} guardada. Agora é só enviar ao corretor.`);
      await onGuardada?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao guardar a minuta");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4 rounded-lg border p-4" data-testid="locacao-montar-contrato">
      <header>
        <h3 className="font-semibold">
          Montar contrato — {d.tipo === "comercial" ? "comercial" : "residencial"} ·{" "}
          {modelo?.titulo || d.garantia.replaceAll("_", " ")}
          {modelo ? ` (modelo v${modelo.versao})` : ""}
        </h3>
        <p className="text-xs text-muted-foreground">
          Monte, confira e use “Gerar e guardar”: o PDF vira uma versão da minuta que o corretor
          baixa. Não gera cobrança, repasse ou assinatura. A minuta mantém a versão do modelo usada.
        </p>
        {d.tipo === "comercial" && modelo?.tipo !== "comercial" && (
          <p className="text-xs text-amber-700">
            Texto-base residencial com bloco de destinação comercial adaptado. Conferência jurídica
            necessária.
          </p>
        )}
        {modelo?.chave === "seguro_porto" && (
          <p className="text-xs text-amber-700">
            Porto Seguro: o texto original usa IGP-M. Confirmar com Larissa antes de enviar.
          </p>
        )}
      </header>
      <nav aria-label="Passos do contrato" className="flex flex-wrap gap-1">
        {PASSOS.map((item, i) => (
          <Button
            key={item}
            size="sm"
            variant={passo === i ? "default" : "outline"}
            onClick={() => setPasso(i)}
          >
            {i + 1}. {item}
          </Button>
        ))}
      </nav>
      <h4 className="font-medium">{PASSOS[passo]}</h4>
      {passo === 0 && (
        <div className="grid gap-2 text-sm">
          <p>
            <b>Imóvel:</b> {d.ficha.imovelId || "—"} · {d.endereco}
          </p>
          <p>
            <b>Proprietário:</b> {v.prop_nome || "a conferir na documentação"}
          </p>
          <p>
            <b>Tipo:</b> {d.tipo === "comercial" ? "Comercial" : "Residencial"}
          </p>
        </div>
      )}
      {passo === 2 && (
        <div className="text-sm">
          <b>Locatário (documentos):</b> {v.loc_nome || "—"} · CPF {v.loc_cpf || "—"}
        </div>
      )}
      {passo === 3 && (
        <div className="grid gap-2 text-sm">
          <p>
            <b>Início:</b> {v.inicio || "—"} · <b>Prazo:</b> {v.prazo_meses || "—"} meses ·{" "}
            <b>Fim calculado:</b> {fim || "—"}
          </p>
          <p>
            <b>Aluguel:</b> R$ {valores.aluguel || "—"} · <b>Vencimento:</b> dia{" "}
            {v.dia_vencimento || "—"}
          </p>
          <p>
            Valores trazidos da ficha e dos documentos; corrija abaixo se necessário. As correções
            não alteram os documentos originais.
          </p>
        </div>
      )}
      {passo === 5 && (
        <div className="space-y-3 text-sm">
          <p>
            <b>Garantia:</b> {d.garantia.replaceAll("_", " ")} ·{" "}
            {modelo?.titulo || "escolha abaixo"}
          </p>
          {d.garantia === "seguro_fianca" && (
            <div className="space-y-1">
              <Label htmlFor="mont-seguradora">Seguradora</Label>
              <select
                id="mont-seguradora"
                value={v.seg_seguradora || ""}
                disabled={busy}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                onChange={(e) => mudar("d_seg_seguradora", e.target.value)}
              >
                <option value="">— Escolha a seguradora —</option>
                <option value="porto">Porto Seguro</option>
                <option value="pottencial">Pottencial</option>
                <option value="tokio">Tokio Marine</option>
                <option value="almada">Almada</option>
              </select>
              <p className="text-xs text-muted-foreground">
                O nº da apólice pode ficar vazio até a seguradora emiti-la. Sem anexo, as chaves não
                são entregues.
              </p>
            </div>
          )}
          {(d.garantia === "caucao" || d.garantia === "outras") && (
            <div className="space-y-1">
              <Label htmlFor="mont-tipo-caucao">Tipo de caução</Label>
              <select
                id="mont-tipo-caucao"
                value={v.cau_tipo || ""}
                disabled={busy}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                onChange={(e) => mudar("d_cau_tipo", e.target.value)}
              >
                <option value="">— Escolha a modalidade —</option>
                {d.garantia === "caucao" && <option value="dinheiro">Dinheiro</option>}
                <option value="imovel">Imóvel caucionado</option>
              </select>
            </div>
          )}
          {d.garantia === "fiador" && (
            <p>
              Matrícula: {v.fia_matricula || "—"} · Cartório: {v.fia_cartorio || "—"}
            </p>
          )}
          {d.garantia === "seguro_fianca" && !m.apolice && (
            <p className="text-amber-700">
              Apólice pendente — anexe para liberar a entrega de chaves.
            </p>
          )}
        </div>
      )}
      {passo === 6 && (
        <p className="text-xs text-muted-foreground">
          Dados guardados para uso futuro do financeiro. Nenhum repasse será executado aqui.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.entries(CAMPOS_DOCUMENTO)
          .filter(
            ([key, index]) =>
              index === passo &&
              key !== "seg_seguradora" &&
              key !== "cau_tipo" &&
              (!key.startsWith("fia_") || d.garantia === "fiador") &&
              (!CAMPOS_GARANTIA.fiador.includes(key) || d.garantia === "fiador") &&
              (!Object.values(CAMPOS_GARANTIA).some((grupo) => grupo.includes(key)) ||
                camposGarantiaAtivos.includes(key)),
          )
          .map(([key]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`mont-d-${key}`}>{key.replaceAll("_", " ")} (ficha/documentos)</Label>
              <Input
                id={`mont-d-${key}`}
                value={valores[`d_${key}`] || ""}
                disabled={busy}
                onChange={(e) => mudar(`d_${key}`, e.target.value)}
                maxLength={key === "moradores" ? 2000 : 300}
              />
            </div>
          ))}
        {Object.entries(CAMPOS)
          .filter(([key, cfg]) => {
            if (cfg.passo !== passo) return false;
            if (
              (key === "fia_imovel_endereco" || key.startsWith("fia_")) &&
              d.garantia !== "fiador"
            )
              return false;
            if (key.endsWith("_adicionais_sexo")) return false;
            if (key === "prop_sexo" && d.ficha.proprietarioPessoa === "pj") return false;
            if (key === "loc_sexo" && d.ficha.locatarioPessoa === "pj") return false;
            if (key === "fia_sexo" && d.ficha.fiadorPessoa === "pj") return false;
            if (
              key === "prop_conj_sexo" &&
              (d.ficha.proprietarioPessoa === "pj" || !v.prop_conj_nome)
            )
              return false;
            if (key === "fia_conj_sexo" && (d.ficha.fiadorPessoa === "pj" || !v.fia_conj_nome))
              return false;
            return true;
          })
          .map(([key, cfg]) => (
            <div
              key={key}
              className={`space-y-1 ${key === "clausulas_adicionais" || key === "assinaturas" ? "sm:col-span-2" : ""}`}
            >
              <Label htmlFor={`mont-${key}`}>{cfg.label}</Label>
              {cfg.opcoes ? (
                <select
                  id={`mont-${key}`}
                  value={valores[key] || ""}
                  disabled={busy}
                  onChange={(e) => mudar(key, e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">— Conferir —</option>
                  {cfg.opcoes.map((op) => (
                    <option key={op} value={op}>
                      {op === "masculino"
                        ? "Masculino"
                        : op === "feminino"
                          ? "Feminino"
                          : op.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              ) : key === "clausulas_adicionais" ||
                key === "locadores_adicionais" ||
                key === "locatarios_adicionais" ||
                key === "assinaturas" ||
                key === "observacao" ? (
                <Textarea
                  id={`mont-${key}`}
                  disabled={busy}
                  value={valores[key] || ""}
                  onChange={(e) => mudar(key, e.target.value)}
                  maxLength={4000}
                />
              ) : (
                <Input
                  id={`mont-${key}`}
                  disabled={busy}
                  value={valores[key] || ""}
                  onChange={(e) => mudar(key, e.target.value)}
                  maxLength={400}
                />
              )}
            </div>
          ))}
        {passo === 0 &&
          linhasPessoas(valores.locadores_adicionais).map((linha, i) => (
            <div key={`locador-sexo-${i}`} className="space-y-1">
              <Label htmlFor={`mont-locadores-sexo-${i}`}>Sexo — {linha.slice(0, 60)}</Label>
              <select
                id={`mont-locadores-sexo-${i}`}
                value={parseSexos(valores.locadores_adicionais_sexo)[i] || ""}
                disabled={busy}
                onChange={(e) => {
                  const linhas = linhasPessoas(valores.locadores_adicionais);
                  const sexos = parseSexos(valores.locadores_adicionais_sexo);
                  while (sexos.length < linhas.length) sexos.push("");
                  sexos[i] = e.target.value;
                  mudar("locadores_adicionais_sexo", sexos.slice(0, linhas.length).join("\n"));
                }}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">— Conferir —</option>
                <option value="masculino">Masculino</option>
                <option value="feminino">Feminino</option>
              </select>
            </div>
          ))}
        {passo === 2 &&
          linhasPessoas(valores.locatarios_adicionais).map((linha, i) => (
            <div key={`locatario-sexo-${i}`} className="space-y-1">
              <Label htmlFor={`mont-locatarios-sexo-${i}`}>Sexo — {linha.slice(0, 60)}</Label>
              <select
                id={`mont-locatarios-sexo-${i}`}
                value={parseSexos(valores.locatarios_adicionais_sexo)[i] || ""}
                disabled={busy}
                onChange={(e) => {
                  const linhas = linhasPessoas(valores.locatarios_adicionais);
                  const sexos = parseSexos(valores.locatarios_adicionais_sexo);
                  while (sexos.length < linhas.length) sexos.push("");
                  sexos[i] = e.target.value;
                  mudar("locatarios_adicionais_sexo", sexos.slice(0, linhas.length).join("\n"));
                }}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">— Conferir —</option>
                <option value="masculino">Masculino</option>
                <option value="feminino">Feminino</option>
              </select>
            </div>
          ))}
      </div>
      {passo === 4 && (
        <p className="text-xs text-muted-foreground">
          Administradora: {m.administradora.nome || "sem nome"} · CNPJ{" "}
          {m.administradora.cnpj || "não cadastrado"} (dados da imobiliária atual). Valores de
          multa, juros e IPCA do texto-base não são reescritos aqui; divergências bloqueiam o PDF.
        </p>
      )}
      {faltas.length > 0 && (
        <p className="text-xs text-amber-700" data-testid="montagem-faltas">
          Para gerar o PDF: {faltas.join("; ")}
        </p>
      )}
      <footer className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={passo === 0} onClick={() => setPasso(passo - 1)}>
          Voltar
        </Button>
        <Button
          variant="outline"
          disabled={passo === PASSOS.length - 1}
          onClick={() => setPasso(passo + 1)}
        >
          Próximo
        </Button>
        <Button disabled={busy || !dirty} onClick={() => void salvar()}>
          Salvar correções
        </Button>
        <Button
          variant="outline"
          disabled={busy || dirty || faltas.length > 0}
          onClick={() => void pdf()}
        >
          Baixar PDF para conferência
        </Button>
        <Button
          disabled={busy || dirty || faltas.length > 0}
          onClick={() => void guardar()}
          data-testid="montagem-gerar-guardar"
        >
          Gerar e guardar como minuta
        </Button>
      </footer>
    </section>
  );
}
