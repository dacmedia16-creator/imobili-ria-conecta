// Página pública do link individual da PRÉ-APROVAÇÃO da locação (sem login). Mesmo visual aprovado do link da
// Documentação (t_6fafa9be), escopo próprio (t_b2ce1207): só mostra a parte do token (locatário ou fiador), nada de
// valores da negociação. Os campos seguem a garantia ATUAL da locação; tudo passa por server functions que validam
// o token no banco.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TOKEN_LINK_RE } from "@/lib/locacao-links";
import {
  extensaoDoc,
  faltasParte,
  reaisParaBanco,
  reaisParaTela,
  TAMANHO_MAX_DOC,
  type Garantia,
} from "@/lib/locacao";
import { supabase } from "@/integrations/supabase/client";
import {
  enviarLinkPreLocacao,
  lerLinkPreLocacao,
  prepararArquivoLinkPreLocacao,
  registrarArquivoLinkPreLocacao,
  salvarLinkPreLocacao,
  type PreLinkResult,
} from "@/lib/locacao-pre-links.functions";

type Campo = { k: string; label: string; tipo?: "date" | "email" | "tel" | "reais" | "cpf" };
const CAMPOS: Record<"locatario" | "fiador", Campo[]> = {
  locatario: [
    { k: "cpf", label: "CPF", tipo: "cpf" },
    { k: "nome", label: "Nome completo" },
    { k: "nascimento", label: "Data de nascimento", tipo: "date" },
    { k: "telefone", label: "Telefone", tipo: "tel" },
    { k: "email", label: "E-mail", tipo: "email" },
    { k: "renda", label: "Renda mensal (R$)", tipo: "reais" },
  ],
  fiador: [
    { k: "nome", label: "Nome completo" },
    { k: "cpf", label: "CPF", tipo: "cpf" },
    { k: "renda", label: "Renda mensal (R$)", tipo: "reais" },
    { k: "matricula", label: "Número da matrícula do imóvel" },
  ],
};
const dia = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export const Route = createFileRoute("/locacao-pre/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pré-aprovação da locação" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: Page,
});

function Page() {
  const { token } = Route.useParams();
  const [dados, setDados] = useState<PreLinkResult | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const valido = TOKEN_LINK_RE.test(token);

  const aplicar = (r: PreLinkResult, comForm: boolean) => {
    setDados(r);
    if (comForm) {
      const d = { ...(r.dados ?? {}) };
      if (d.renda) d.renda = reaisParaTela(d.renda);
      setForm(d);
    }
  };
  const atualizar = async () => {
    const r = valido ? await lerLinkPreLocacao({ data: { token } }) : { ok: false };
    if (r.ok) aplicar(r, false);
    else setErro(true);
  };
  useEffect(() => {
    let ativo = true;
    if (!valido) {
      setErro(true);
      setCarregando(false);
      return;
    }
    void lerLinkPreLocacao({ data: { token } })
      .then((r) => {
        if (!ativo) return;
        if (r.ok) aplicar(r, true);
        else setErro(true);
        setCarregando(false);
      })
      .catch(() => {
        if (ativo) {
          setErro(true);
          setCarregando(false);
        }
      });
    return () => {
      ativo = false;
    };
  }, [token, valido]);

  const parte = dados?.parte === "fiador" ? "fiador" : "locatario";
  const campos = CAMPOS[parte].filter((c) => c.k !== "renda" || dados?.pede_renda);
  const banco = () =>
    Object.fromEntries(
      campos.map((c) => [
        c.k,
        c.tipo === "reais" ? reaisParaBanco(form[c.k] ?? "") : (form[c.k] ?? "").trim(),
      ]),
    );
  // Mesma regra do banco (locacao_pre_parte_faltando), pela garantia ATUAL da locação.
  const faltas = dados
    ? faltasParte(parte, (dados.garantia ?? "seguro_fianca") as Garantia, banco())
    : [];

  const agir = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };
  const salvar = async (aviso = true) => {
    const reaisRuins = campos.filter(
      (c) => c.tipo === "reais" && (form[c.k] ?? "").trim() && !reaisParaBanco(form[c.k] ?? ""),
    );
    if (reaisRuins.length) throw new Error("Informe a renda em reais, por exemplo 7.800,00.");
    const r = await salvarLinkPreLocacao({ data: { token, dados: banco() } });
    if (!r.ok) throw new Error("Link indisponível ou dado inválido. Confira e tente de novo.");
    if (aviso) toast.success("Rascunho salvo");
  };
  const upload = (arquivo?: File) => {
    if (!arquivo) return;
    void agir(async () => {
      const ext = extensaoDoc(arquivo.name);
      if (!ext || arquivo.size > TAMANHO_MAX_DOC)
        throw new Error("Envie PDF ou imagem de até 16 MB.");
      const p = await prepararArquivoLinkPreLocacao({ data: { token, ext } });
      if (!p.ok || !p.path || !p.token) throw new Error("Link indisponível.");
      const { error } = await supabase.storage
        .from("locacao-documentos")
        .uploadToSignedUrl(p.path, p.token, arquivo, { contentType: arquivo.type || undefined });
      if (error) throw new Error("Não foi possível enviar o arquivo.");
      const r = await registrarArquivoLinkPreLocacao({
        data: { token, path: p.path, nome: arquivo.name.slice(0, 200) },
      });
      if (!r.ok) throw new Error("Arquivo não registrado.");
      await atualizar();
      toast.success("Matrícula recebida");
    });
  };
  const enviar = () => {
    if (faltas.length) {
      toast.error(`Falta preencher: ${faltas.join(", ")}.`);
      return;
    }
    if (!window.confirm("Depois de enviar, você não poderá mais editar. Enviar ao corretor?"))
      return;
    void agir(async () => {
      await salvar(false);
      const r = await enviarLinkPreLocacao({ data: { token } });
      if (!r.ok)
        throw new Error(
          r.faltando?.length
            ? `Falta preencher: ${r.faltando.join(", ")}.`
            : "Link indisponível. Peça um novo ao corretor.",
        );
      await atualizar();
      toast.success("Enviado ao corretor");
    });
  };
  const nomeParte = parte === "fiador" ? "Fiador" : "Locatário";

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900 sm:px-3 sm:py-6">
      <main className="mx-auto max-w-xl overflow-hidden bg-white shadow-sm sm:rounded-xl">
        <header className="bg-[#003DA5] px-5 py-6 text-white">
          <p className="text-xs font-semibold tracking-widest opacity-80">MAX · LOCAÇÃO</p>
          <h1 className="mt-1 text-2xl font-bold">Pré-aprovação da locação</h1>
          <p className="mt-1 text-sm opacity-90">
            {dados
              ? `Formulário individual do ${nomeParte.toLowerCase()}. Seus dados seguem primeiro ao corretor.`
              : "Formulário individual. Seus dados seguem primeiro ao corretor."}
          </p>
        </header>
        <div className="space-y-5 p-5">
          {carregando && <p role="status">Carregando…</p>}
          {erro && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
              Link indisponível ou vencido. Peça um novo link ao seu corretor.
            </p>
          )}
          {dados && !erro && (
            <>
              <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-[#003DA5]">
                {nomeParte} ·{" "}
                {dados.status === "enviado"
                  ? "enviado"
                  : `link válido até ${dados.expira_em ? dia(dados.expira_em) : "—"}`}
              </span>
              {dados.status === "enviado" ? (
                <section role="status" className="space-y-3 text-center">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700">
                    ✓
                  </div>
                  <h2 className="text-xl font-bold">Enviado ao corretor</h2>
                  <p className="text-sm text-slate-600">
                    Recebemos seus dados. O corretor vai conferir e enviar para a pré-aprovação.
                    Para correções, fale com ele ou peça um novo link.
                  </p>
                </section>
              ) : (
                <>
                  <section className="space-y-4">
                    <div>
                      <h2 className="text-lg font-bold">Preencha seus dados</h2>
                      <p className="text-sm text-slate-600">
                        Somente sua parte é exibida aqui. Nenhum documento é obrigatório agora.
                      </p>
                    </div>
                    {campos.map((c) => (
                      <div key={c.k} className="space-y-1">
                        <Label htmlFor={c.k}>{c.label}</Label>
                        <Input
                          id={c.k}
                          type={c.tipo === "date" ? "date" : c.tipo === "email" ? "email" : "text"}
                          inputMode={
                            c.tipo === "reais"
                              ? "decimal"
                              : c.tipo === "cpf"
                                ? "numeric"
                                : c.tipo === "tel"
                                  ? "tel"
                                  : undefined
                          }
                          placeholder={
                            c.tipo === "reais"
                              ? "0,00"
                              : c.tipo === "cpf"
                                ? "000.000.000-00"
                                : undefined
                          }
                          maxLength={c.tipo === "cpf" ? 14 : 200}
                          value={form[c.k] ?? ""}
                          onChange={(e) => setForm((f) => ({ ...f, [c.k]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </section>
                  {dados.anexo_matricula && (
                    <section className="space-y-2">
                      <h2 className="text-lg font-bold">Matrícula do imóvel (opcional)</h2>
                      <div className="rounded-lg border border-blue-100 p-3 text-sm">
                        {(dados.arquivos ?? []).map((n) => (
                          <p key={n} className="font-semibold text-slate-800">
                            ✓ {n}
                          </p>
                        ))}
                        <label className="mt-1 inline-block cursor-pointer font-semibold text-[#003DA5]">
                          {dados.arquivos?.length ? "+ Anexar outro" : "+ Anexar PDF ou imagem"}
                          <input
                            className="sr-only"
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp"
                            disabled={busy}
                            onChange={(e) => {
                              upload(e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    </section>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => void agir(salvar)}>
                      Salvar rascunho
                    </Button>
                    <Button disabled={busy} onClick={enviar}>
                      Enviar ao corretor
                    </Button>
                  </div>
                  {faltas.length > 0 && (
                    <p className="text-xs text-slate-500" data-testid="pre-link-faltas">
                      Falta preencher: {faltas.join(", ")}.
                    </p>
                  )}
                  <p className="text-xs text-slate-500">
                    Após enviar, somente o corretor poderá corrigir ou emitir outro link.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
