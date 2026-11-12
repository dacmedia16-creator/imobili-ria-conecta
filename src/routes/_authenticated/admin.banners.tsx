import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GalleryHorizontal, ImagePlus, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageHeader,
  Pill,
  type Tom,
} from "@/components/visual/base";
import {
  BANNER_TAMANHO_MAX,
  BANNER_TIPOS,
  ORIENTACAO_IMAGEM,
  extensaoBanner,
  foraDaProporcao,
  hojeSaoPaulo,
  linkBannerValido,
  papeisDoPublico,
  rotuloPublico,
  situacaoBanner,
  somarDias,
  type BannerCadastro,
} from "@/lib/home-banners";
import {
  ativarBanner,
  bannersCadastro,
  excluirBanner,
  prepararEnvioBanner,
  salvarBanner,
} from "@/lib/home-banners.functions";

export const Route = createFileRoute("/_authenticated/admin/banners")({
  head: () => ({ meta: [{ title: "Banners do Início" }] }),
  // O banco é a proteção real (RPCs home_banner*); aqui só evita abrir a tela para quem não gerencia.
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/dashboard" });
    const { data: pode } = await (supabase as unknown as SupabaseClient).rpc(
      "home_banner_pode_gerir",
    );
    if (pode !== true) throw redirect({ to: "/dashboard" });
  },
  component: BannersAdmin,
});

type Draft = {
  id: string | null;
  titulo: string;
  imagemPath: string | null;
  previa: string | null;
  link: string;
  inicio: string;
  fim: string;
  todos: boolean;
  publico: string[];
  ordem: string;
  ativo: boolean;
};

const novoDraft = (): Draft => {
  const hoje = hojeSaoPaulo();
  return {
    id: null,
    titulo: "",
    imagemPath: null,
    previa: null,
    link: "",
    inicio: hoje,
    fim: somarDias(hoje, 30),
    todos: true,
    publico: [],
    ordem: "0",
    ativo: true,
  };
};

const SITUACAO: Record<ReturnType<typeof situacaoBanner>, { tom: Tom; texto: string }> = {
  no_ar: { tom: "green", texto: "No ar" },
  agendado: { tom: "blue", texto: "Agendado" },
  encerrado: { tom: "slate", texto: "Encerrado" },
  desativado: { tom: "amber", texto: "Desativado" },
};

const dataBr = (d: string) => d.split("-").reverse().join("/");

function medirImagem(arquivo: File): Promise<{ w: number; h: number }> {
  return new Promise((ok) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      ok({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      ok({ w: 0, h: 0 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function BannersAdmin() {
  const listar = useServerFn(bannersCadastro);
  const preparar = useServerFn(prepararEnvioBanner);
  const salvar = useServerFn(salvarBanner);
  const ativar = useServerFn(ativarBanner);
  const excluir = useServerFn(excluirBanner);
  const [lista, setLista] = useState<BannerCadastro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [avisoProporcao, setAvisoProporcao] = useState<string | null>(null);
  const [apagar, setApagar] = useState<BannerCadastro | null>(null);
  const hoje = hojeSaoPaulo();
  const papeis = papeisDoPublico();

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(false);
    try {
      setLista(await listar());
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [listar]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const editar = (b: BannerCadastro) => {
    setAvisoProporcao(null);
    setDraft({
      id: b.id,
      titulo: b.titulo,
      imagemPath: b.imagem_path,
      previa: b.url,
      link: b.link ?? "",
      inicio: b.inicio,
      fim: b.fim,
      todos: b.publico.length === 0,
      publico: b.publico,
      ordem: String(b.ordem),
      ativo: b.ativo,
    });
  };

  const escolherImagem = async (arquivo: File | undefined) => {
    if (!arquivo || !draft) return;
    const ext = extensaoBanner(arquivo.type);
    if (!ext) return toast.error("Envie uma imagem JPG, PNG ou WEBP.");
    if (arquivo.size > BANNER_TAMANHO_MAX) return toast.error("A imagem passa de 2 MB.");
    setEnviando(true);
    try {
      const { w, h } = await medirImagem(arquivo);
      setAvisoProporcao(
        foraDaProporcao(w, h)
          ? `Esta imagem tem ${w} × ${h} px, fora da proporção 3:1. Ela aparece inteira, mas com faixas nas laterais ou em cima e embaixo.`
          : null,
      );
      const { path, token } = await preparar({ data: { ext } });
      const { error } = await supabase.storage
        .from("home-banners")
        .uploadToSignedUrl(path, token, arquivo, { contentType: arquivo.type });
      if (error) throw new Error(error.message);
      setDraft((d) => (d ? { ...d, imagemPath: path, previa: URL.createObjectURL(arquivo) } : d));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a imagem.");
    } finally {
      setEnviando(false);
    }
  };

  const gravar = async () => {
    if (!draft) return;
    const ordem = Number(draft.ordem);
    if (draft.titulo.trim().length < 2) return toast.error("Dê um nome ao banner.");
    if (!draft.imagemPath) return toast.error("Envie a imagem do banner.");
    if (!linkBannerValido(draft.link))
      return toast.error(
        "Link inválido: use uma tela do ADM (começando com /) ou um endereço https://.",
      );
    if (!draft.inicio || !draft.fim || draft.fim < draft.inicio)
      return toast.error("A data final precisa ser igual ou depois da inicial.");
    if (!Number.isInteger(ordem) || ordem < 0 || ordem > 999)
      return toast.error("Ordem de 0 a 999.");
    if (!draft.todos && draft.publico.length === 0)
      return toast.error("Escolha ao menos um papel ou marque “Todos”.");
    setSalvando(true);
    try {
      await salvar({
        data: {
          id: draft.id,
          titulo: draft.titulo.trim(),
          imagemPath: draft.imagemPath,
          link: draft.link.trim() || null,
          inicio: draft.inicio,
          fim: draft.fim,
          publico: draft.todos ? [] : draft.publico,
          ordem,
          ativo: draft.ativo,
        },
      });
      toast.success("Banner salvo.");
      setDraft(null);
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  };

  const alternar = async (b: BannerCadastro, ativo: boolean) => {
    try {
      await ativar({ data: { id: b.id, ativo } });
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar.");
    }
  };

  const confirmarExclusao = async () => {
    if (!apagar) return;
    try {
      await excluir({ data: { id: apagar.id } });
      toast.success("Banner excluído.");
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={GalleryHorizontal}
        title="Banners do Início"
        description="Imagens que passam sozinhas no topo do Início de quem é da sua imobiliária. Só a sua imobiliária vê estes banners."
        actions={
          !draft && (
            <Button
              onClick={() => {
                setAvisoProporcao(null);
                setDraft(novoDraft());
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Novo banner
            </Button>
          )
        }
      />

      <Card className="border-dashed">
        <CardContent className="flex gap-3 p-4 text-sm" data-testid="banner-orientacao">
          <ImagePlus className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="font-medium">Tamanho padrão da imagem</p>
            <p className="text-muted-foreground">{ORIENTACAO_IMAGEM}</p>
          </div>
        </CardContent>
      </Card>

      {draft && (
        <Card data-testid="banner-form">
          <CardHeader>
            <CardTitle>{draft.id ? "Editar banner" : "Novo banner"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bn-titulo">Nome do banner</Label>
              <Input
                id="bn-titulo"
                maxLength={80}
                value={draft.titulo}
                onChange={(e) => setDraft({ ...draft, titulo: e.target.value })}
                placeholder="Ex.: Campanha de captação de dezembro"
              />
              <p className="text-xs text-muted-foreground">
                Também é o texto lido por leitores de tela.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bn-imagem">Imagem</Label>
              {draft.previa && (
                <div className="aspect-[3/1] w-full max-w-xl overflow-hidden rounded-xl border bg-muted">
                  <img
                    src={draft.previa}
                    alt="Prévia do banner"
                    className="h-full w-full object-contain"
                  />
                </div>
              )}
              <Input
                id="bn-imagem"
                type="file"
                accept={BANNER_TIPOS.join(",")}
                disabled={enviando}
                onChange={(e) => void escolherImagem(e.target.files?.[0])}
              />
              <p className="text-xs text-muted-foreground">
                {enviando ? "Enviando a imagem…" : ORIENTACAO_IMAGEM}
              </p>
              {avisoProporcao && <p className="text-xs text-amber-600">{avisoProporcao}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bn-link">Link (opcional)</Label>
              <Input
                id="bn-link"
                maxLength={500}
                value={draft.link}
                onChange={(e) => setDraft({ ...draft, link: e.target.value })}
                placeholder="/vendas  ou  https://site.com.br/pagina"
              />
              <p className="text-xs text-muted-foreground">
                Tela do ADM começando com “/” abre no próprio sistema; endereço “https://” abre em
                outra aba.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="bn-inicio">Começa em</Label>
                <Input
                  id="bn-inicio"
                  type="date"
                  value={draft.inicio}
                  onChange={(e) => setDraft({ ...draft, inicio: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bn-fim">Termina em</Label>
                <Input
                  id="bn-fim"
                  type="date"
                  value={draft.fim}
                  onChange={(e) => setDraft({ ...draft, fim: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Sai do ar sozinho depois deste dia.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bn-ordem">Ordem</Label>
                <Input
                  id="bn-ordem"
                  type="number"
                  min={0}
                  max={999}
                  value={draft.ordem}
                  onChange={(e) => setDraft({ ...draft, ordem: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Menor número aparece primeiro.</p>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Quem vê</legend>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.todos}
                  onCheckedChange={(v) => setDraft({ ...draft, todos: v === true, publico: [] })}
                />
                Todos da imobiliária
              </label>
              {!draft.todos && (
                <div className="grid gap-2 sm:grid-cols-3">
                  {papeis.map((p) => (
                    <label key={p.valor} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={draft.publico.includes(p.valor)}
                        onCheckedChange={(v) =>
                          setDraft({
                            ...draft,
                            publico:
                              v === true
                                ? [...draft.publico, p.valor]
                                : draft.publico.filter((x) => x !== p.valor),
                          })
                        }
                      />
                      {p.rotulo}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Quem tem mais de um papel vê o banner se qualquer um deles estiver marcado. O
                Fotógrafo não usa o Início e não recebe banner.
              </p>
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={draft.ativo}
                onCheckedChange={(v) => setDraft({ ...draft, ativo: v })}
              />
              Ativo
            </label>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void gravar()} disabled={salvando || enviando}>
                {salvando ? "Salvando…" : "Salvar banner"}
              </Button>
              <Button variant="outline" onClick={() => setDraft(null)} disabled={salvando}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {carregando ? (
        <ListSkeleton />
      ) : erro ? (
        <ErrorState onRetry={() => void recarregar()}>
          Não foi possível carregar os banners.
        </ErrorState>
      ) : lista.length === 0 ? (
        <EmptyState icon={GalleryHorizontal}>
          Nenhum banner cadastrado. Sem banner, o Início fica como está hoje. Toque em “Novo banner”
          para criar o primeiro.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2" data-testid="banner-lista">
          {lista.map((b) => {
            const s = SITUACAO[situacaoBanner(b, hoje)];
            return (
              <Card key={b.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="aspect-[3/1] w-full overflow-hidden rounded-xl border bg-muted">
                    {b.url && (
                      <img src={b.url} alt={b.titulo} className="h-full w-full object-contain" />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{b.titulo}</p>
                    <Pill tom={s.tom}>{s.texto}</Pill>
                  </div>
                  <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Período</dt>
                    <dd>
                      {dataBr(b.inicio)} a {dataBr(b.fim)}
                    </dd>
                    <dt className="text-muted-foreground">Quem vê</dt>
                    <dd>{rotuloPublico(b.publico)}</dd>
                    <dt className="text-muted-foreground">Link</dt>
                    <dd className="break-all">{b.link || "—"}</dd>
                    <dt className="text-muted-foreground">Ordem</dt>
                    <dd>{b.ordem}</dd>
                  </dl>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={b.ativo}
                        onCheckedChange={(v) => void alternar(b, v)}
                        aria-label={`Ativar ${b.titulo}`}
                      />
                      Ativo
                    </label>
                    <Button size="sm" variant="outline" onClick={() => editar(b)}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setApagar(b)}>
                      Excluir
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={apagar !== null}
        onOpenChange={(o) => !o && setApagar(null)}
        title="Excluir banner?"
        description={`O banner “${apagar?.titulo ?? ""}” e a imagem dele serão apagados. Para só tirar do ar, use “Ativo”.`}
        confirmLabel="Excluir"
        destructive
        onConfirm={() => void confirmarExclusao()}
      />
    </div>
  );
}
