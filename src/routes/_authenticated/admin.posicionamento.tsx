import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MapPinned, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/posicionamento")({
  head: () => ({ meta: [{ title: "Sugestões de regiões" }] }),
  component: AdminPositioning,
});

type Suggestion = { id: string; suggested_by: string; nome: string; cidade: string; zona: string | null; tipo: string; created_at: string };

function AdminPositioning() {
  const { hasAny } = useAuth();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Suggestion | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from("positioning_region_suggestions").select("id, suggested_by, nome, cidade, zona, tipo, created_at").eq("status", "pendente").order("created_at");
    if (error) { toast.error(error.message); return; }
    setItems(data ?? []);
    const ids = [...new Set((data ?? []).map((item) => item.suggested_by))];
    if (ids.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, nome").in("id", ids);
      setNames(Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile.nome])));
    }
  };
  useEffect(() => { if (hasAny(["admin", "super_admin"])) load(); }, []);

  if (!hasAny(["admin", "super_admin"])) return <p className="text-sm text-muted-foreground">Apenas administradores podem analisar sugestões.</p>;

  const review = async (decision: "aprovar" | "rejeitar", item: Suggestion) => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("review_positioning_region_suggestion", {
        _suggestion_id: item.id, _decision: decision, _nome: item.nome,
        _cidade: item.cidade, _zona: item.zona ?? "", _tipo: item.tipo,
      });
      if (error) { toast.error(error.message); return; }
      toast.success(decision === "aprovar" ? "Região aprovada e adicionada ao catálogo" : "Sugestão rejeitada");
      setEditing(null); await load();
    } finally { setSaving(false); }
  };

  return <div className="space-y-6">
    <div className="flex items-center gap-2"><MapPinned className="h-5 w-5 text-primary" /><h1 className="text-2xl font-semibold tracking-tight">Sugestões de regiões</h1></div>
    <p className="text-sm text-muted-foreground">Revise nomes para evitar duplicidades antes de disponibilizar a região para todos os corretores.</p>
    {items.length === 0 && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Nenhuma sugestão pendente.</CardContent></Card>}
    <div className="grid gap-4">
      {items.map((item) => {
        const current = editing?.id === item.id ? editing : item;
        const isEditing = editing?.id === item.id;
        return <Card key={item.id}><CardHeader><CardTitle className="text-base">{item.nome}</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="text-xs text-muted-foreground">Sugerido por <b>{names[item.suggested_by] ?? "Corretor"}</b> em {new Date(item.created_at).toLocaleDateString("pt-BR")}</div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div><Label>Nome</Label><Input disabled={!isEditing} value={current.nome} onChange={(e) => setEditing({ ...current, nome: e.target.value })} /></div>
            <div><Label>Cidade</Label><Input disabled={!isEditing} value={current.cidade} onChange={(e) => setEditing({ ...current, cidade: e.target.value })} /></div>
            <div><Label>Zona</Label><Input disabled={!isEditing} value={current.zona ?? ""} onChange={(e) => setEditing({ ...current, zona: e.target.value })} /></div>
            <div><Label>Tipo</Label><Select disabled={!isEditing} value={current.tipo} onValueChange={(tipo) => setEditing({ ...current, tipo })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bairro">Bairro</SelectItem><SelectItem value="condominio">Condomínio</SelectItem><SelectItem value="cidade">Cidade</SelectItem><SelectItem value="grupo">Grupo</SelectItem></SelectContent></Select></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isEditing && <Button variant="outline" onClick={() => setEditing({ ...item })}>Revisar dados</Button>}
            {isEditing && <Button variant="outline" onClick={() => setEditing(null)}>Cancelar edição</Button>}
            <Button onClick={() => review("aprovar", current)} disabled={saving}><Check className="mr-2 h-4 w-4" />Aprovar</Button>
            <Button variant="destructive" onClick={() => review("rejeitar", item)} disabled={saving}><X className="mr-2 h-4 w-4" />Rejeitar</Button>
          </div>
        </CardContent></Card>;
      })}
    </div>
  </div>;
}
