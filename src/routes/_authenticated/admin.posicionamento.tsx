import { createFileRoute } from "@tanstack/react-router";
import { anyOf, requireRoles } from "@/lib/route-access";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPinned, Check, X, Plus, Merge, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { EmptyState, PageHeader, Pill } from "@/components/visual/base";
import { agencyCity, agencyUf, loadAgencyProfile } from "@/lib/agency-profile";
import {
  createOrgRegion,
  decideOrgRegion,
  editRegion,
  listOrgRegions,
  listPlatformPendingRegions,
  type OrgRegion,
  type PlatformPendingRegion,
} from "@/lib/positioning-db";
import { REGION_STATUS_LABEL } from "@/lib/especialistas-publico";

export const Route = createFileRoute("/_authenticated/admin/posicionamento")({
  head: () => ({ meta: [{ title: "Regiões e sugestões" }] }),
  beforeLoad: ({ context }) => requireRoles(context.auth, anyOf("admin", "super_admin")),
  component: AdminPositioning,
});

type Suggestion = {
  id: string;
  suggested_by: string;
  nome: string;
  cidade: string;
  zona: string | null;
  tipo: string;
  created_at: string;
};

const TIPOS = [
  ["bairro", "Bairro"],
  ["condominio", "Condomínio"],
  ["cidade", "Cidade"],
  ["grupo", "Grupo"],
] as const;

function TipoSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select disabled={disabled} value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Tipo">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TIPOS.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AdminPositioning() {
  const { hasAny } = useAuth();
  const isAdmin = hasAny(["admin", "super_admin"]);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Suggestion | null>(null);
  const [saving, setSaving] = useState(false);
  const [regions, setRegions] = useState<OrgRegion[]>([]);
  const [platformPending, setPlatformPending] = useState<PlatformPendingRegion[] | null>(null);
  const [agency, setAgency] = useState<{ cidade: string; uf: string } | null>(null);
  const [nova, setNova] = useState({ nome: "", cidade: "", uf: "", zona: "", tipo: "bairro" });
  const [decidindo, setDecidindo] = useState<{
    region: OrgRegion;
    modo: "recusar" | "juntar";
    motivo: string;
    alvo: string;
  } | null>(null);
  const [editandoRegiao, setEditandoRegiao] = useState<{
    region: OrgRegion;
    nome: string;
    zona: string;
    tipo: string;
  } | null>(null);

  const loadSuggestions = useCallback(async () => {
    const { data, error } = await supabase
      .from("positioning_region_suggestions")
      .select("id, suggested_by, nome, cidade, zona, tipo, created_at")
      .eq("status", "pendente")
      .order("created_at");
    if (error) {
      toast.error(error.message);
      return;
    }
    setItems(data ?? []);
    const ids = [...new Set((data ?? []).map((item) => item.suggested_by))];
    if (ids.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, nome").in("id", ids);
      setNames(Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile.nome])));
    }
  }, []);

  const loadRegions = useCallback(async () => {
    try {
      setRegions(await listOrgRegions());
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  const load = useCallback(async () => {
    await Promise.all([loadSuggestions(), loadRegions()]);
  }, [loadSuggestions, loadRegions]);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
    loadAgencyProfile()
      .then((a) => {
        const cidade = agencyCity(a.cidade);
        const uf = agencyUf(a.uf, a.cidade);
        setAgency({ cidade, uf });
        setNova((n) => ({ ...n, cidade, uf }));
      })
      .catch(() => {});
    // Visão da plataforma (só leitura): falha calada para quem não é administrador da plataforma.
    listPlatformPendingRegions()
      .then(setPlatformPending)
      .catch(() => setPlatformPending(null));
  }, [isAdmin, load]);

  const pendentes = useMemo(() => regions.filter((r) => r.status === "pendente"), [regions]);
  const ativas = useMemo(() => regions.filter((r) => r.status === "ativa"), [regions]);
  const outras = useMemo(
    () => regions.filter((r) => r.status === "recusada" || r.status === "juntada"),
    [regions],
  );

  if (!isAdmin)
    return (
      <p className="text-sm text-muted-foreground">
        Apenas administradores podem gerenciar regiões.
      </p>
    );

  const review = async (decision: "aprovar" | "rejeitar", item: Suggestion) => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("review_positioning_region_suggestion", {
        _suggestion_id: item.id,
        _decision: decision,
        _nome: item.nome,
        _cidade: item.cidade,
        _zona: item.zona ?? "",
        _tipo: item.tipo,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(
        decision === "aprovar"
          ? "Região aprovada para a sua imobiliária e o corretor foi vinculado"
          : "Sugestão rejeitada",
      );
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const criar = async () => {
    setSaving(true);
    try {
      const r = await createOrgRegion(nova);
      if (r.resultado === "criada")
        toast.success(
          r.pendentes > 0
            ? `Região criada. Já vale para a sua imobiliária; ${r.pendentes} outra(s) imobiliária(s) da cidade vão decidir se usam.`
            : "Região criada.",
        );
      else if (r.resultado === "vinculada")
        toast.success("Essa região já existia na cidade e agora vale para a sua imobiliária.");
      else toast.info("Essa região já está na sua lista.");
      setNova((n) => ({ ...n, nome: "", zona: "" }));
      await loadRegions();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const decidir = async (
    region: OrgRegion,
    decisao: "aprovar" | "recusar" | "juntar",
    motivo?: string,
    alvo?: number,
  ) => {
    setSaving(true);
    try {
      await decideOrgRegion(region.id, decisao, motivo, alvo);
      toast.success(
        decisao === "aprovar"
          ? "Região aprovada para a sua imobiliária"
          : decisao === "recusar"
            ? "Região recusada para a sua imobiliária"
            : "Região juntada",
      );
      setDecidindo(null);
      await loadRegions();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const salvarEdicao = async () => {
    if (!editandoRegiao) return;
    setSaving(true);
    try {
      await editRegion(editandoRegiao.region.id, {
        nome: editandoRegiao.nome,
        zona: editandoRegiao.zona,
        tipo: editandoRegiao.tipo,
        ativo: true,
      });
      toast.success("Região alterada");
      setEditandoRegiao(null);
      await loadRegions();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const desativar = async (region: OrgRegion) => {
    if (!window.confirm(`Desativar "${region.nome}" para toda a cidade?`)) return;
    setSaving(true);
    try {
      await editRegion(region.id, {
        nome: region.nome,
        zona: region.zona ?? "",
        tipo: region.tipo,
        ativo: false,
      });
      toast.success("Região desativada");
      await loadRegions();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const alvosJuntar = decidindo
    ? ativas.filter(
        (r) =>
          r.id !== decidindo.region.id &&
          r.cidade.toLocaleLowerCase("pt-BR") === decidindo.region.cidade.toLocaleLowerCase("pt-BR"),
      )
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={MapPinned}
        title="Regiões e sugestões"
        description="As regiões são da cidade e compartilhadas entre as imobiliárias dela. Cada imobiliária decide quais usa."
        actions={
          (items.length > 0 || pendentes.length > 0) && (
            <Pill tom="amber">{items.length + pendentes.length} para decidir</Pill>
          )
        }
      />

      <Tabs defaultValue={pendentes.length > 0 && items.length === 0 ? "pedidos" : "sugestoes"}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="sugestoes">Sugestões dos corretores ({items.length})</TabsTrigger>
          <TabsTrigger value="pedidos">
            Regiões novas para aprovar ({pendentes.length})
          </TabsTrigger>
          <TabsTrigger value="lista">Regiões da imobiliária ({ativas.length})</TabsTrigger>
          {platformPending && (
            <TabsTrigger value="plataforma">Plataforma ({platformPending.length})</TabsTrigger>
          )}
        </TabsList>

        {/* Sugestões dos corretores da própria imobiliária */}
        <TabsContent value="sugestoes" className="space-y-4">
          {items.length === 0 && (
            <EmptyState icon={MapPinned}>Nenhuma sugestão pendente.</EmptyState>
          )}
          <p className="text-xs text-muted-foreground">
            Ao aprovar, a região passa a valer na hora para a sua imobiliária e o corretor que
            sugeriu é vinculado a ela. Se a região já existir na cidade, nada é duplicado. As
            outras imobiliárias da mesma cidade recebem o pedido e decidem se também usam.
          </p>
          <div className="grid gap-4">
            {items.map((item) => {
              const current = editing?.id === item.id ? editing : item;
              const isEditing = editing?.id === item.id;
              return (
                <Card key={item.id} className="rounded-xl border-l-4 border-l-amber-400 shadow-sm">
                  <CardHeader>
                    <CardTitle className="break-words text-base">{item.nome}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-xs text-muted-foreground">
                      Sugerido por <b>{names[item.suggested_by] ?? "Corretor"}</b> em{" "}
                      {new Date(item.created_at).toLocaleDateString("pt-BR")}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div>
                        <Label>Nome</Label>
                        <Input
                          aria-label="Nome"
                          disabled={!isEditing}
                          value={current.nome}
                          onChange={(e) => setEditing({ ...current, nome: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Cidade</Label>
                        <Input
                          aria-label="Cidade"
                          disabled={!isEditing}
                          value={current.cidade}
                          onChange={(e) => setEditing({ ...current, cidade: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Zona</Label>
                        <Input
                          aria-label="Zona"
                          disabled={!isEditing}
                          value={current.zona ?? ""}
                          onChange={(e) => setEditing({ ...current, zona: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Tipo</Label>
                        <TipoSelect
                          disabled={!isEditing}
                          value={current.tipo}
                          onChange={(tipo) => setEditing({ ...current, tipo })}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!isEditing && (
                        <Button variant="outline" onClick={() => setEditing({ ...item })}>
                          Revisar dados
                        </Button>
                      )}
                      {isEditing && (
                        <Button variant="outline" onClick={() => setEditing(null)}>
                          Cancelar edição
                        </Button>
                      )}
                      <Button onClick={() => review("aprovar", current)} disabled={saving}>
                        <Check className="mr-2 h-4 w-4" />
                        Aprovar
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => review("rejeitar", item)}
                        disabled={saving}
                      >
                        <X className="mr-2 h-4 w-4" />
                        Rejeitar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Regiões criadas por outras imobiliárias da mesma cidade: decisão só para esta imobiliária */}
        <TabsContent value="pedidos" className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Regiões novas criadas por outra imobiliária da sua cidade. A sua decisão vale só para a
            sua imobiliária: aprovada, aparece para os seus corretores e na sua página pública.
          </p>
          {pendentes.length === 0 && (
            <EmptyState icon={MapPinned}>Nenhuma região nova para aprovar.</EmptyState>
          )}
          <div className="grid gap-3">
            {pendentes.map((r) => (
              <Card key={r.id} className="rounded-xl border-l-4 border-l-blue-400 shadow-sm">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="break-words font-medium">{r.nome}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.cidade}/{r.uf}
                      {r.zona ? ` · ${r.zona}` : ""} · {r.tipo} · pedido por{" "}
                      <b>{r.origem_nome}</b>
                      {r.pedido_por ? ` (${r.pedido_por})` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => decidir(r, "aprovar")} disabled={saving}>
                      <Check className="mr-1 h-4 w-4" /> Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDecidindo({ region: r, modo: "juntar", motivo: "", alvo: "" })}
                      disabled={saving}
                    >
                      <Merge className="mr-1 h-4 w-4" /> Juntar com existente
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        setDecidindo({ region: r, modo: "recusar", motivo: "", alvo: "" })
                      }
                      disabled={saving}
                    >
                      <X className="mr-1 h-4 w-4" /> Recusar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {outras.length > 0 && (
            <div className="space-y-1 text-xs text-muted-foreground">
              <b className="text-foreground">Já decididas (não usadas pela sua imobiliária):</b>
              {outras.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {r.nome} — {REGION_STATUS_LABEL[r.status]}
                    {r.motivo ? `: ${r.motivo}` : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => decidir(r, "aprovar")}
                    disabled={saving}
                  >
                    Passar a usar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Lista ativa da imobiliária + criar nova */}
        <TabsContent value="lista" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4" /> Nova região
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-5">
                <div className="sm:col-span-2">
                  <Label>Nome</Label>
                  <Input
                    aria-label="Nome da nova região"
                    value={nova.nome}
                    onChange={(e) => setNova({ ...nova, nome: e.target.value })}
                    placeholder="Ex.: Jardim Europa"
                  />
                </div>
                <div>
                  <Label>Cidade</Label>
                  <Input
                    aria-label="Cidade da nova região"
                    value={nova.cidade}
                    onChange={(e) => setNova({ ...nova, cidade: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Zona</Label>
                  <Input
                    aria-label="Zona da nova região"
                    value={nova.zona}
                    onChange={(e) => setNova({ ...nova, zona: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Tipo</Label>
                  <TipoSelect value={nova.tipo} onChange={(tipo) => setNova({ ...nova, tipo })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                UF: {nova.uf || "cadastre a UF em Dados da imobiliária"}. Se outra imobiliária da
                cidade{agency ? ` (${agency.cidade})` : ""} já tiver a região com o mesmo nome, ela é
                reaproveitada. Se for nova, vale na hora para você e as outras imobiliárias da cidade
                decidem se usam.
              </p>
              <Button onClick={criar} disabled={saving || !nova.nome.trim() || !nova.uf}>
                Criar região
              </Button>
            </CardContent>
          </Card>
          {ativas.length === 0 && (
            <EmptyState icon={MapPinned}>Nenhuma região ativa na sua imobiliária.</EmptyState>
          )}
          <div className="grid gap-2">
            {ativas.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3 text-sm"
              >
                <div className="min-w-0">
                  <span className="break-words font-medium">{r.nome}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {r.cidade}/{r.uf}
                    {r.zona ? ` · ${r.zona}` : ""} · {r.tipo} · {r.corretores_meus}{" "}
                    {r.corretores_meus === 1 ? "corretor" : "corretores"}
                    {!r.da_minha ? ` · criada por ${r.origem_nome}` : ""}
                  </span>
                </div>
                {r.da_minha && !r.usada_por_outras && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditandoRegiao({
                          region: r,
                          nome: r.nome,
                          zona: r.zona ?? "",
                          tipo: r.tipo,
                        })
                      }
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => desativar(r)} disabled={saving}>
                      Desativar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Só a imobiliária que criou pode renomear ou desativar a região, e apenas enquanto
            nenhum corretor de outra imobiliária a usa. Nos demais casos, fale com o administrador
            da plataforma.
          </p>
        </TabsContent>

        {platformPending && (
          <TabsContent value="plataforma" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Visão do administrador da plataforma (somente consulta): pedidos que aguardam decisão
              de cada imobiliária. A plataforma não aprova no lugar da imobiliária.
            </p>
            {platformPending.length === 0 && (
              <EmptyState icon={MapPinned}>Nenhum pedido aguardando.</EmptyState>
            )}
            {platformPending.map((p) => (
              <div
                key={`${p.region_id}-${p.para_nome}`}
                className="rounded-md border bg-card p-3 text-sm"
              >
                <b className="break-words">{p.nome}</b>{" "}
                <span className="text-xs text-muted-foreground">
                  {p.cidade}/{p.uf} · pedido por {p.origem_nome} · aguardando {p.para_nome} desde{" "}
                  {new Date(p.created_at).toLocaleDateString("pt-BR")}
                </span>
              </div>
            ))}
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={!!decidindo} onOpenChange={(open) => !open && setDecidindo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decidindo?.modo === "recusar" ? "Recusar região" : "Juntar com região existente"}
            </DialogTitle>
          </DialogHeader>
          {decidindo && (
            <div className="grid gap-3 py-2 text-sm">
              <p>
                <b>{decidindo.region.nome}</b> ({decidindo.region.cidade}) — a decisão vale só para
                a sua imobiliária.
              </p>
              {decidindo.modo === "juntar" && (
                <div>
                  <Label>Região que a sua imobiliária já usa</Label>
                  <Select
                    value={decidindo.alvo}
                    onValueChange={(alvo) => setDecidindo({ ...decidindo, alvo })}
                  >
                    <SelectTrigger aria-label="Região existente">
                      <SelectValue placeholder="Escolha a região" />
                    </SelectTrigger>
                    <SelectContent>
                      {alvosJuntar.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          {r.nome}
                          {r.zona ? ` — ${r.zona}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>
                  Motivo{decidindo.modo === "juntar" ? " (opcional)" : ""}
                </Label>
                <Input
                  aria-label="Motivo"
                  value={decidindo.motivo}
                  maxLength={500}
                  onChange={(e) => setDecidindo({ ...decidindo, motivo: e.target.value })}
                  placeholder={
                    decidindo.modo === "recusar" ? "Ex.: não atuamos nessa região" : "Ex.: é o mesmo bairro"
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecidindo(null)}>
              Cancelar
            </Button>
            <Button
              variant={decidindo?.modo === "recusar" ? "destructive" : "default"}
              disabled={
                saving ||
                !decidindo ||
                (decidindo.modo === "recusar" && decidindo.motivo.trim().length < 3) ||
                (decidindo.modo === "juntar" && !decidindo.alvo)
              }
              onClick={() =>
                decidindo &&
                decidir(
                  decidindo.region,
                  decidindo.modo,
                  decidindo.motivo,
                  decidindo.alvo ? Number(decidindo.alvo) : undefined,
                )
              }
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editandoRegiao} onOpenChange={(open) => !open && setEditandoRegiao(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar região</DialogTitle>
          </DialogHeader>
          {editandoRegiao && (
            <div className="grid gap-3 py-2">
              <div>
                <Label>Nome</Label>
                <Input
                  aria-label="Nome"
                  value={editandoRegiao.nome}
                  onChange={(e) => setEditandoRegiao({ ...editandoRegiao, nome: e.target.value })}
                />
              </div>
              <div>
                <Label>Zona</Label>
                <Input
                  aria-label="Zona"
                  value={editandoRegiao.zona}
                  onChange={(e) => setEditandoRegiao({ ...editandoRegiao, zona: e.target.value })}
                />
              </div>
              <div>
                <Label>Tipo</Label>
                <TipoSelect
                  value={editandoRegiao.tipo}
                  onChange={(tipo) => setEditandoRegiao({ ...editandoRegiao, tipo })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditandoRegiao(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarEdicao} disabled={saving}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
