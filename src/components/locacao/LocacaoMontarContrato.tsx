import { useEffect, useState } from "react";
import fonteUrl from "@/assets/fonts/DejaVuSans.ttf?url";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { lerMontagem, salvarMontagem } from "@/lib/locacao-db";
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
  type LocacaoBase,
  type Montagem,
} from "@/lib/locacao-montagem";

export function LocacaoMontarContrato({
  d,
}: {
  d: LocacaoBase & { id: string; docsCompleta: boolean; ficha: { imovelId: string } };
}) {
  const [m, setM] = useState<Montagem | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [passo, setPasso] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [erro, setErro] = useState("");
  useEffect(() => {
    if (!d.docsCompleta || d.tipo !== "residencial" || d.garantia !== "fiador") return;
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
  if (d.tipo !== "residencial" || d.garantia !== "fiador")
    return (
      <p className="text-sm">
        Modelo disponível apenas para locação residencial com fiador. Outros modelos dependem de
        definição.
      </p>
    );
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
  const pdf = async () => {
    setBusy(true);
    try {
      // Revalida a trava no servidor imediatamente antes de gerar e usa somente os dados salvos.
      const fresh = (await lerMontagem(d.id)) as Montagem;
      const paragrafos = textoContrato(d, fresh, camposIniciais(d, fresh));
      const fonteResposta = await fetch(fonteUrl);
      if (!fonteResposta.ok) throw new Error("Fonte do PDF indisponível");
      const bytes = await gerarPdfContrato(paragrafos, await fonteResposta.arrayBuffer());
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contrato-${d.codigo.replace(/[^a-zA-Z0-9-]/g, "-")}-conferencia.pdf`;
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
  return (
    <section className="space-y-4 rounded-lg border p-4" data-testid="locacao-montar-contrato">
      <header>
        <h3 className="font-semibold">Montar contrato — residencial com fiador</h3>
        <p className="text-xs text-muted-foreground">
          Rascunho para conferência. Não gera cobrança, repasse ou assinatura. Condições divergentes
          do modelo exigem revisão jurídica.
        </p>
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
            <b>Tipo:</b> Residencial
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
        <div className="text-sm">
          <p>
            <b>Garantia:</b> FIADOR · {v.fia_nome || "—"}
          </p>
          <p>
            Matrícula: {v.fia_matricula || "—"} · Cartório: {v.fia_cartorio || "—"}
          </p>
        </div>
      )}
      {passo === 6 && (
        <p className="text-xs text-muted-foreground">
          Dados guardados para uso futuro do financeiro. Nenhum repasse será executado aqui.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.entries(CAMPOS_DOCUMENTO)
          .filter(([, index]) => index === passo)
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
          .filter(([, cfg]) => cfg.passo === passo)
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
                      {op.replaceAll("_", " ")}
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
        <Button disabled={busy || dirty || faltas.length > 0} onClick={() => void pdf()}>
          Gerar PDF para conferência
        </Button>
      </footer>
    </section>
  );
}
