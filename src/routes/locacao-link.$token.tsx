// Página pública do link individual da Locação (sem login). Visual aprovado por Denis na maquete de 13/11
// (t_6fafa9be). Só mostra a parte do token; tudo passa por server functions que validam o token no banco.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { camposDaParte, TOKEN_LINK_RE, type ParteLink } from "@/lib/locacao-links";
import { ESTADOS_CIVIS, valorOk } from "@/lib/locacao-contrato";
import { extensaoDoc, TAMANHO_MAX_DOC } from "@/lib/locacao";
import { supabase } from "@/integrations/supabase/client";
import {
  enviarLinkLocacao,
  lerLinkLocacao,
  prepararArquivoLinkLocacao,
  registrarArquivoLinkLocacao,
  salvarLinkLocacao,
} from "@/lib/locacao-links.functions";

type Dados = {
  ok: boolean;
  parte: ParteLink;
  pessoa: string;
  status: string;
  dados: Record<string, string>;
  itens: { item: string; enviado: boolean }[];
  expira_em: string;
};
const nomes: Record<ParteLink, string> = {
  proprietario: "Proprietário",
  locatario: "Locatário",
  fiador: "Fiador",
};
const dia = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export const Route = createFileRoute("/locacao-link/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Documentação da locação" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: Page,
});

function Page() {
  const { token } = Route.useParams();
  const [dados, setDados] = useState<Dados | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const valido = TOKEN_LINK_RE.test(token);
  const atualizar = async () => {
    const r = valido ? await lerLinkLocacao({ data: { token } }) : { ok: false };
    if (r.ok) setDados(r as unknown as Dados);
    else setErro(true);
    setCarregando(false);
  };
  useEffect(() => {
    let ativo = true;
    if (!valido) {
      setErro(true);
      setCarregando(false);
      return;
    }
    void lerLinkLocacao({ data: { token } })
      .then((r) => {
        if (!ativo) return;
        if (r.ok) {
          const d = r as unknown as Dados;
          setDados(d);
          setForm(d.dados ?? {});
        } else setErro(true);
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
    const campos = dados ? camposDaParte(dados.parte, form) : [];
    const invalidos = campos.filter((c) => !valorOk(c.k, (form[c.k] ?? "").trim()));
    if (invalidos.length)
      throw new Error("Confira os campos: " + invalidos.map((c) => c.label).join(", "));
    const r = await salvarLinkLocacao({
      data: { token, dados: Object.fromEntries(campos.map((c) => [c.k, form[c.k] ?? ""])) },
    });
    if (!r.ok) throw new Error("Link indisponível. Peça um novo ao corretor.");
    if (aviso) toast.success("Rascunho salvo");
  };
  const upload = (item: string, arquivo?: File) => {
    if (!arquivo) return;
    void agir(async () => {
      const ext = extensaoDoc(arquivo.name);
      if (!ext || arquivo.size > TAMANHO_MAX_DOC)
        throw new Error("Envie PDF ou imagem de até 16 MB.");
      const p = await prepararArquivoLinkLocacao({ data: { token, item, ext } });
      if (!p.ok || !p.path || !p.token) throw new Error("Link indisponível.");
      const { error } = await supabase.storage
        .from("locacao-documentos")
        .uploadToSignedUrl(p.path, p.token, arquivo, { contentType: arquivo.type || undefined });
      if (error) throw new Error("Não foi possível enviar o arquivo.");
      const r = await registrarArquivoLinkLocacao({
        data: { token, path: p.path, nome: arquivo.name.slice(0, 200) },
      });
      if (!r.ok) throw new Error("Arquivo não registrado.");
      await atualizar();
      toast.success("Documento recebido");
    });
  };
  const enviar = () => {
    if (!window.confirm("Depois de enviar, você não poderá mais editar. Enviar ao corretor?"))
      return;
    void agir(async () => {
      await salvar(false);
      const r = await enviarLinkLocacao({ data: { token } });
      if (!r.ok) throw new Error("Link indisponível.");
      await atualizar();
      toast.success("Enviado ao corretor");
    });
  };
  const parte = dados ? nomes[dados.parte] : "";

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900 sm:px-3 sm:py-6">
      <main className="mx-auto max-w-xl overflow-hidden bg-white shadow-sm sm:rounded-xl">
        <header className="bg-[#003DA5] px-5 py-6 text-white">
          <p className="text-xs font-semibold tracking-widest opacity-80">MAX · LOCAÇÃO</p>
          <h1 className="mt-1 text-2xl font-bold">Seus dados para a locação</h1>
          <p className="mt-1 text-sm opacity-90">
            {dados
              ? `Formulário individual do ${parte.toLowerCase()}. Seus dados seguem primeiro ao corretor.`
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
                {parte}
                {dados.pessoa === "pj" ? " (PJ)" : ""} ·{" "}
                {dados.status === "enviado" ? "enviado" : `link válido até ${dia(dados.expira_em)}`}
              </span>
              {dados.status === "enviado" ? (
                <section role="status" className="space-y-3 text-center">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700">
                    ✓
                  </div>
                  <h2 className="text-xl font-bold">Enviado ao corretor</h2>
                  <p className="text-sm text-slate-600">
                    Recebemos seus dados e documentos. O corretor vai conferir antes do próximo
                    passo. Para correções, fale com ele ou peça um novo link.
                  </p>
                </section>
              ) : (
                <>
                  <section className="space-y-4">
                    <div>
                      <h2 className="text-lg font-bold">Preencha seus dados</h2>
                      <p className="text-sm text-slate-600">
                        Somente sua parte é exibida aqui. O corretor confere antes de enviar.
                      </p>
                    </div>
                    {camposDaParte(dados.parte, form).map((c) => (
                      <div key={c.k} className="space-y-1">
                        <Label htmlFor={c.k}>{c.label}</Label>
                        {c.tipo === "estado_civil" ? (
                          <select
                            id={c.k}
                            className="h-10 w-full rounded-md border px-2"
                            value={form[c.k] ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, [c.k]: e.target.value }))}
                          >
                            <option value="">Selecione</option>
                            {ESTADOS_CIVIS.map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            id={c.k}
                            type={c.tipo === "data" ? "date" : "text"}
                            value={form[c.k] ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, [c.k]: e.target.value }))}
                          />
                        )}
                      </div>
                    ))}
                  </section>
                  <section className="space-y-3">
                    <h2 className="text-lg font-bold">Seus documentos</h2>
                    {dados.itens.map((x) => (
                      <div key={x.item} className="rounded-lg border border-blue-100 p-3 text-sm">
                        <p className="font-semibold text-slate-800">
                          {x.enviado ? "✓ " : ""}
                          {x.item}
                        </p>
                        <label className="mt-1 inline-block cursor-pointer font-semibold text-[#003DA5]">
                          {x.enviado ? "+ Anexar outro" : "+ Anexar PDF ou imagem"}
                          <input
                            className="sr-only"
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp"
                            disabled={busy}
                            onChange={(e) => {
                              upload(x.item, e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    ))}
                  </section>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => void agir(salvar)}>
                      Salvar rascunho
                    </Button>
                    <Button disabled={busy} onClick={enviar}>
                      Enviar ao corretor
                    </Button>
                  </div>
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
