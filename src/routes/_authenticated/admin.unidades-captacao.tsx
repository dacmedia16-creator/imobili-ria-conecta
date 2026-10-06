import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { guardExclusiveRoute } from "@/lib/exclusive-captures-guard";
import { listUnits, saveUnit } from "@/lib/exclusive-captures-db";
import { UNIT_FIELDS, type ExclusiveUnit, type UnitField } from "@/lib/exclusive-captures";
import { errorMessage } from "@/lib/errors";
import { formatCnpj, isValidCnpj } from "@/lib/platform-organizations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/unidades-captacao")({
  head: () => ({ meta: [{ title: "Unidades da captação — Administração" }] }),
  beforeLoad: guardExclusiveRoute,
  component: UnitsAdmin,
});

type Draft = Record<UnitField, string> & { ativo: boolean };
const emptyDraft = (): Draft => ({
  nome: "",
  creci: "",
  razao_social: "",
  cnpj: "",
  endereco: "",
  cidade: "",
  estado: "",
  nome_comercial: "",
  ativo: true,
});
const toDraft = (u: ExclusiveUnit): Draft => ({
  nome: u.nome,
  creci: u.creci,
  razao_social: u.razao_social,
  cnpj: u.cnpj,
  endereco: u.endereco,
  cidade: u.cidade,
  estado: u.estado,
  nome_comercial: u.nome_comercial,
  ativo: u.ativo,
});

/** Cadastro das unidades usadas no contrato de exclusividade (dados impressos no PDF). */
function UnitsAdmin() {
  const { hasAny } = useAuth();
  const canEdit = hasAny(["admin", "super_admin"]);
  const [units, setUnits] = useState<ExclusiveUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | "nova" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const reload = () =>
    listUnits()
      .then(setUnits)
      .catch((e) => toast.error(errorMessage(e, "Falha ao carregar unidades")))
      .finally(() => setLoading(false));
  useEffect(() => {
    void reload();
  }, []);
  const open = (u: ExclusiveUnit | null) => {
    setEditing(u ? u.id : "nova");
    setDraft(u ? toDraft(u) : emptyDraft());
  };
  const missing = UNIT_FIELDS.filter((f) => !draft[f.key].trim());
  const save = async () => {
    if (missing.length) {
      toast.error(`Preencha: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    if (!isValidCnpj(draft.cnpj)) {
      toast.error(
        "CNPJ inválido. Confira os 14 números do CNPJ da unidade (ex.: 13.662.631/0001-18).",
      );
      return;
    }
    setSaving(true);
    try {
      await saveUnit(editing === "nova" ? null : editing, {
        ...draft,
        cnpj: formatCnpj(draft.cnpj),
      });
      toast.success("Unidade salva. Os próximos contratos gerados usarão estes dados.");
      setEditing(null);
      await reload();
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Não foi possível salvar a unidade"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Unidades da captação exclusiva</h1>
          <p className="text-sm text-muted-foreground">
            Dados da unidade impressos no contrato de exclusividade (razão social, CNPJ, CRECI,
            endereço e nome comercial).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/exclusividades">
              <ArrowLeft className="mr-1 h-4 w-4" /> Captações
            </Link>
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => open(null)} disabled={editing !== null}>
              <Plus className="mr-1 h-4 w-4" /> Nova unidade
            </Button>
          )}
        </div>
      </div>

      {editing !== null && (
        <Card>
          <CardHeader>
            <CardTitle>{editing === "nova" ? "Nova unidade" : "Editar unidade"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {UNIT_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`unit-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`unit-${f.key}`}
                    value={draft[f.key]}
                    placeholder={f.placeholder}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.ativo}
                onChange={(e) => setDraft({ ...draft, ativo: e.target.checked })}
              />
              Unidade ativa (aparece em “Nova captação”)
            </label>
            <div className="flex gap-2">
              <Button onClick={save} disabled={saving}>
                {saving ? "Salvando…" : "Salvar"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="divide-y pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : units.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma unidade cadastrada. Sem unidade, não é possível criar captações.
            </p>
          ) : (
            units.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">
                    {u.nome}
                    {!u.ativo && (
                      <span className="ml-2 rounded-full border px-2 py-0.5 text-xs">Inativa</span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {u.razao_social} · CNPJ {u.cnpj} · CRECI {u.creci}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {u.endereco} · {u.cidade}/{u.estado}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => open(u)}
                    disabled={editing !== null}
                  >
                    Editar
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
