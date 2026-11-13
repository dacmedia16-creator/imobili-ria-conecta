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
  const atualizar = async (inicial = false) => {
    const r = valido ? await lerLinkLocacao({ data: { token } }) : { ok: false };
    if (r.ok) {
      const d = r as unknown as Dados;
      setDados(d);
      if (inicial) setForm(d.dados ?? {});
    } else setErro(true);
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
  const salvar = async () => {
    const campos = dados ? camposDaParte(dados.parte, form) : [];
    const invalidos = campos.filter((c) => !valorOk(c.k, (form[c.k] ?? "").trim()));
    if (invalidos.length)
      throw new Error("Confira os campos: " + invalidos.map((c) => c.label).join(", "));
    const r = await salvarLinkLocacao({
      data: { token, dados: Object.fromEntries(campos.map((c) => [c.k, form[c.k] ?? ""])) },
    });
    if (!r.ok) throw new Error("Link indisponível. Peça um novo ao corretor.");
    toast.success("Dados salvos");
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

  return (
    <div className="min-h-dvh bg-slate-100 px-3 py-6 text-slate-900">
      <main className="mx-auto max-w-xl overflow-hidden rounded-xl bg-white shadow-sm">
        <header className="bg-[#003DA5] px-5 py-5 text-white">
          <h1 className="text-xl font-bold">Documentação da locação</h1>
          <p className="text-sm">Preencha somente os seus dados e envie seus documentos.</p>
        </header>
        <div className="space-y-6 p-5">
          {carregando && <p role="status">Carregando…</p>}
          {erro && (
            <p role="alert">Link indisponível ou vencido. Peça um novo link ao seu corretor.</p>
          )}
          {dados && !erro && (
            <>
              <div>
                <h2 className="text-lg font-semibold">
                  {nomes[dados.parte]} {dados.pessoa === "pj" ? "PJ" : "PF"}
                </h2>
                <p className="text-sm text-slate-600">
                  Seus dados seguem apenas para conferência do corretor. Não são enviados
                  diretamente à gestão.
                </p>
              </div>
              {dados.status === "enviado" ? (
                <p role="status" className="rounded bg-emerald-50 p-3">
                  Enviado ao corretor. Para correções, fale com ele ou peça um novo link.
                </p>
              ) : (
                <>
                  <section className="space-y-4">
                    <h3 className="font-semibold">Seus dados</h3>
                    {camposDaParte(dados.parte, form).map((c) => (
                      <div key={c.k} className="space-y-1">
                        <Label htmlFor={c.k}>{c.label}</Label>
                        {c.tipo === "estado_civil" ? (
                          <select
                            id={c.k}
                            className="h-10 w-full rounded border px-2"
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
                    <Button variant="outline" disabled={busy} onClick={() => void agir(salvar)}>
                      Salvar dados
                    </Button>
                  </section>
                  <section className="space-y-3">
                    <h3 className="font-semibold">Documentos desta parte</h3>
                    {dados.itens.map((x) => (
                      <div key={x.item} className="rounded border p-3 text-sm">
                        <p>
                          {x.enviado ? "✓ " : "□ "}
                          {x.item}
                        </p>
                        <label className="mt-2 inline-block cursor-pointer text-blue-700 underline">
                          {x.enviado ? "Anexar outro" : "Anexar arquivo"}
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
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void agir(async () => {
                        await salvar();
                        const r = await enviarLinkLocacao({ data: { token } });
                        if (!r.ok) throw new Error("Link indisponível.");
                        await atualizar();
                        toast.success("Enviado ao corretor");
                      })
                    }
                  >
                    Enviar ao corretor
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
