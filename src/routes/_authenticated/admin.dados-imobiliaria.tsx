import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  loadAgencyProfile,
  listAgencyRooms,
  saveAgencyProfile,
  saveAgencyRoom,
  type AgencyProfile,
  type AgencyRoom,
} from "@/lib/agency-profile";
import { uploadAgencyLogo } from "@/lib/agency-profile.functions";
import { fixedLogoForOrganization } from "@/lib/agency-letterhead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/dados-imobiliaria")({
  head: () => ({ meta: [{ title: "Dados da imobiliária" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/dashboard" });
    const { data: allowed } = await (supabase as unknown as SupabaseClient).rpc("agency_can_edit");
    if (allowed !== true) throw redirect({ to: "/dashboard" });
  },
  component: AgencySettings,
});

type Draft = Pick<
  AgencyProfile,
  "razao_social" | "creci" | "cidade" | "uf" | "cor_primaria" | "cor_secundaria"
>;
const emptyRoom = (): AgencyRoom => ({ id: "", nome: "", ativo: true, ordem: 0 });
function AgencySettings() {
  const { hasAny } = useAuth();
  const uploadLogo = useServerFn(uploadAgencyLogo);
  const [profile, setProfile] = useState<AgencyProfile | null>(null);
  const [rooms, setRooms] = useState<AgencyRoom[]>([]);
  const [draft, setDraft] = useState<Draft>({
    razao_social: "",
    creci: "",
    cidade: "",
    uf: "",
    cor_primaria: "",
    cor_secundaria: "",
  });
  const [editingRoom, setEditingRoom] = useState<AgencyRoom | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const canEdit = hasAny(["admin", "super_admin"]);
  const reload = async () => {
    const [agency, available] = await Promise.all([loadAgencyProfile(), listAgencyRooms()]);
    setProfile(agency);
    setDraft({
      razao_social: agency.razao_social ?? "",
      creci: agency.creci ?? "",
      cidade: agency.cidade ?? "",
      uf: agency.uf ?? "",
      cor_primaria: agency.cor_primaria ?? "",
      cor_secundaria: agency.cor_secundaria ?? "",
    });
    setRooms(available);
    setLogoUrl(
      agency.logo_path
        ? supabase.storage.from("organization-logos").getPublicUrl(agency.logo_path).data.publicUrl
        : fixedLogoForOrganization(agency.id),
    );
  };
  useEffect(() => {
    void reload()
      .catch(() => toast.error("Não foi possível carregar os dados da imobiliária."))
      .finally(() => setLoading(false));
  }, []);
  const saveProfile = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await saveAgencyProfile(draft);
      await reload();
      toast.success("Dados da imobiliária salvos.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar os dados.");
    } finally {
      setSaving(false);
    }
  };
  const saveRoom = async () => {
    if (!canEdit || !editingRoom) return;
    setSaving(true);
    try {
      await saveAgencyRoom({ ...editingRoom, id: editingRoom.id || undefined });
      setRooms(await listAgencyRooms());
      setEditingRoom(null);
      toast.success("Sala salva.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a sala.");
    } finally {
      setSaving(false);
    }
  };
  const saveLogo = async () => {
    if (!canEdit || !logoFile) return;
    setSaving(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("Falha ao ler arquivo."));
        reader.readAsDataURL(logoFile);
      });
      const result = await uploadLogo({
        data: { base64, contentType: logoFile.type as "image/png" | "image/jpeg" | "image/webp" },
      });
      setLogoUrl(`${result.url}?t=${Date.now()}`);
      setLogoFile(null);
      toast.success("Logo atualizado.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar o logo.");
    } finally {
      setSaving(false);
    }
  };
  if (loading) return <p>Carregando dados da imobiliária…</p>;
  if (!profile) return <p>Dados da imobiliária indisponíveis.</p>;
  const field = (key: keyof Draft, label: string, placeholder?: string) => (
    <div className="space-y-1" key={key}>
      <Label htmlFor={`agency-${key}`}>{label}</Label>
      <Input
        id={`agency-${key}`}
        value={draft[key] ?? ""}
        placeholder={placeholder}
        onChange={(event) => setDraft((value) => ({ ...value, [key]: event.target.value }))}
      />
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Building2 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Dados da imobiliária</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        {profile.nome} · Dados usados na impressão, no mapa e na marca do portal.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Empresa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {field("razao_social", "Razão social")}
            {field("creci", "CRECI", "Ex.: CRECI: 29.886-J")}
            {field("cidade", "Cidade")}
            {field("uf", "UF", "SP")}
          </div>
          <Button onClick={saveProfile} disabled={saving || !canEdit}>
            {saving ? "Salvando…" : "Salvar dados e cores"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Marca</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={`Logo ${profile.nome}`}
              className="h-20 max-w-48 object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum logo cadastrado.</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("cor_primaria", "Cor primária", "#1a2b3c")}
            {field("cor_secundaria", "Cor secundária", "#ffffff")}
          </div>
          <p className="text-xs text-muted-foreground">
            Cores opcionais no formato hexadecimal (#rrggbb). Use “Salvar dados e cores” acima.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="agency-logo">Logo (PNG, JPEG ou WEBP, até 1 MB)</Label>
              <Input
                id="agency-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button disabled={saving || !logoFile || !canEdit} onClick={saveLogo}>
              Enviar logo
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Salas de reunião</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/reservas-salas">Ver reservas</Link>
            </Button>
            {canEdit && (
              <Button size="sm" onClick={() => setEditingRoom(emptyRoom())}>
                <Plus className="mr-1 h-4 w-4" /> Nova sala
              </Button>
            )}
          </div>
          {rooms.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma sala cadastrada.</p>
          )}
          <div className="divide-y">
            {rooms.map((room) => (
              <div key={room.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {room.nome}
                  {!room.ativo && (
                    <span className="ml-2 text-xs text-muted-foreground">Inativa</span>
                  )}
                </span>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => setEditingRoom(room)}>
                    Editar
                  </Button>
                )}
              </div>
            ))}
          </div>
          {editingRoom && (
            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-4">
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="room-name">Nome da sala</Label>
                <Input
                  id="room-name"
                  value={editingRoom.nome}
                  maxLength={80}
                  onChange={(e) => setEditingRoom({ ...editingRoom, nome: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="room-order">Ordem</Label>
                <Input
                  id="room-order"
                  type="number"
                  min={0}
                  value={editingRoom.ordem}
                  onChange={(e) =>
                    setEditingRoom({ ...editingRoom, ordem: Number(e.target.value) })
                  }
                />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={editingRoom.ativo}
                  onChange={(e) => setEditingRoom({ ...editingRoom, ativo: e.target.checked })}
                />
                Ativa
              </label>
              {editingRoom.id && (
                <p className="text-xs text-muted-foreground sm:col-span-4">
                  Esta sala tem reservas futuras? Cancele ou aguarde as reservas futuras para
                  renomear ou desativar.
                </p>
              )}
              <div className="flex gap-2 sm:col-span-4">
                <Button onClick={saveRoom} disabled={saving || !editingRoom.nome.trim()}>
                  Salvar sala
                </Button>
                <Button variant="outline" onClick={() => setEditingRoom(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
