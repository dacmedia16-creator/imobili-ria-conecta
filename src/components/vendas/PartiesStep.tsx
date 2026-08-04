import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wizard } from "@/components/Wizard";
import { parteLabel, parteSortKey } from "@/lib/status";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { type Saver, useAutosave, AutosaveStatus, FieldGrid, Field } from "./shared";

const partePapelSort = (a: string, b: string) => {
  const ka = parteSortKey(a), kb = parteSortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1];
};

// -------- Partes step (buffered) --------
// Compradores e vendedores são em número livre — o corretor adiciona quantos precisar, um bloco
// (nested Wizard) por pessoa, e só o "_1" de cada lado é obrigatório/fixo.
export function PartiesStep({ saleId, parties, editable, onSaved, registerSaver, onDirtyChange }: {
  saleId: string; parties: Record<string, any>; editable: boolean; onSaved: () => void;
  registerSaver: (fn: Saver | null) => void; onDirtyChange: (d: boolean) => void;
}) {
  const [papeis, setPapeis] = useState<string[]>(() => {
    const fromDb = Object.keys(parties).filter((p) => /^(vendedor|comprador)_\d+$/.test(p));
    return Array.from(new Set(["vendedor_1", "comprador_1", ...fromDb])).sort(partePapelSort);
  });
  const [forms, setForms] = useState<Record<string, any>>(() => {
    const m: Record<string, any> = {};
    papeis.forEach(p => { m[p] = parties[p] ?? {}; });
    return m;
  });
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const anyDirty = useMemo(() => Object.values(dirty).some(Boolean), [dirty]);
  const [saving, setSaving] = useState(false);

  // Não sincroniza por cima de uma parte com edição local não salva: "parties" chega com objeto
  // novo a cada load() do pai, disparado por ações sem relação com esta aba (upload de contrato,
  // troca de status, etc.) — sem preservar quem está dirty, isso apagava silenciosamente o que a
  // pessoa estava digitando e cancelava o autosave (dirty virava false no meio do delay).
  useEffect(() => {
    setForms((prev) => {
      const m: Record<string, any> = {};
      for (const p of papeis) m[p] = dirty[p] ? prev[p] : (parties[p] ?? prev[p] ?? {});
      return m;
    });
    setDirty((prev) => {
      const next: Record<string, boolean> = {};
      for (const p of papeis) if (prev[p]) next[p] = true;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parties]);

  useEffect(() => { onDirtyChange(anyDirty); }, [anyDirty, onDirtyChange]);

  const update = (papel: string, k: string, v: string) => {
    setForms(f => ({ ...f, [papel]: { ...f[papel], [k]: v } }));
    setDirty(d => ({ ...d, [papel]: true }));
  };

  const [activePapel, setActivePapel] = useState(papeis[0]);

  const addPapel = (tipo: "vendedor" | "comprador") => {
    const nums = papeis.filter((p) => p.startsWith(`${tipo}_`)).map((p) => Number(p.split("_")[1]));
    const novoPapel = `${tipo}_${(nums.length ? Math.max(...nums) : 0) + 1}`;
    setPapeis((prev) => [...prev, novoPapel].sort(partePapelSort));
    setForms((f) => ({ ...f, [novoPapel]: {} }));
    setActivePapel(novoPapel);
  };

  const removePapel = async (papel: string) => {
    const existing = parties[papel];
    if (existing?.id) {
      const { error } = await supabase.from("sale_parties").delete().eq("id", existing.id);
      if (error) { toast.error(error.message); return; }
    }
    const idx = papeis.indexOf(papel);
    setPapeis((prev) => prev.filter((p) => p !== papel));
    setForms((f) => { const n = { ...f }; delete n[papel]; return n; });
    setDirty((d) => { const n = { ...d }; delete n[papel]; return n; });
    if (activePapel === papel) setActivePapel(papeis[idx - 1] ?? papeis[idx + 1] ?? papeis[0]);
    toast.success("Removido");
    onSaved();
  };

  const saveAll = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      for (const papel of papeis) {
        if (!dirty[papel]) continue;
        const existing = parties[papel];
        const data = {
          nome: forms[papel].nome ?? null, rg: forms[papel].rg ?? null, cpf_cnpj: forms[papel].cpf_cnpj ?? null,
          profissao: forms[papel].profissao ?? null, email: forms[papel].email ?? null, telefone: forms[papel].telefone ?? null,
          endereco: forms[papel].endereco ?? null, regime_casamento: forms[papel].regime_casamento ?? null,
          tipo_pessoa: forms[papel].tipo_pessoa ?? "fisica", razao_social: forms[papel].razao_social ?? null,
        };
        const { error } = existing
          ? await supabase.from("sale_parties").update(data).eq("id", existing.id)
          : await supabase.from("sale_parties").insert({ sale_id: saleId, papel, ...data });
        if (error) { toast.error(error.message); return false; }
      }
      setDirty({});
      onSaved();
      return true;
    } finally {
      setSaving(false);
    }
  }, [dirty, forms, papeis, parties, saleId, onSaved]);

  useEffect(() => { registerSaver(saveAll); return () => registerSaver(null); }, [saveAll, registerSaver]);
  useAutosave(editable && anyDirty, [forms, dirty], saveAll);

  return (
    <div className="space-y-4">
      {editable && <AutosaveStatus saving={saving} dirty={anyDirty} />}
      <Wizard
        steps={papeis.map((p, i) => {
          const numero = Number(p.split("_")[1]);
          return {
          key: p,
          label: parteLabel(p),
          content: (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{parteLabel(p)}</CardTitle>
            {editable && numero > 1 && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => removePapel(p)}>Remover</Button>
            )}
          </CardHeader>
          <CardContent>
            <FieldGrid>
              <Field label="Tipo de pessoa">
                <Select value={forms[p].tipo_pessoa ?? "fisica"} onValueChange={(v) => update(p, "tipo_pessoa", v)} disabled={!editable}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fisica">Pessoa física</SelectItem>
                    <SelectItem value="juridica">Pessoa jurídica</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Nome"><Input value={forms[p].nome ?? ""} onChange={(e) => update(p, "nome", e.target.value)} disabled={!editable} /></Field>
              {(forms[p].tipo_pessoa ?? "fisica") === "juridica" ? (
                <>
                  <Field label="Razão social"><Input value={forms[p].razao_social ?? ""} onChange={(e) => update(p, "razao_social", e.target.value)} disabled={!editable} /></Field>
                  <Field label="CNPJ"><Input value={forms[p].cpf_cnpj ?? ""} onChange={(e) => update(p, "cpf_cnpj", e.target.value)} disabled={!editable} /></Field>
                </>
              ) : (
                <>
                  <Field label="RG"><Input value={forms[p].rg ?? ""} onChange={(e) => update(p, "rg", e.target.value)} disabled={!editable} /></Field>
                  <Field label="CPF"><Input value={forms[p].cpf_cnpj ?? ""} onChange={(e) => update(p, "cpf_cnpj", e.target.value)} disabled={!editable} /></Field>
                  <Field label="Profissão"><Input value={forms[p].profissao ?? ""} onChange={(e) => update(p, "profissao", e.target.value)} disabled={!editable} /></Field>
                </>
              )}
              <Field label="E-mail"><Input type="email" value={forms[p].email ?? ""} onChange={(e) => update(p, "email", e.target.value)} disabled={!editable} /></Field>
              <Field label="Telefone"><Input value={forms[p].telefone ?? ""} onChange={(e) => update(p, "telefone", e.target.value)} disabled={!editable} /></Field>
              <Field label="Endereço" colSpan={2}><Input value={forms[p].endereco ?? ""} onChange={(e) => update(p, "endereco", e.target.value)} disabled={!editable} /></Field>
              {(forms[p].tipo_pessoa ?? "fisica") === "fisica" && (
                <Field label="Regime de casamento"><Input value={forms[p].regime_casamento ?? ""} onChange={(e) => update(p, "regime_casamento", e.target.value)} placeholder="Ex.: Comunhão parcial de bens" disabled={!editable} /></Field>
              )}
            </FieldGrid>
          </CardContent>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-0">
            <div className="flex gap-2">
              {editable && (
                <>
                  <Button size="sm" variant="outline" onClick={() => addPapel("comprador")}>+ Adicionar comprador</Button>
                  <Button size="sm" variant="outline" onClick={() => addPapel("vendedor")}>+ Adicionar vendedor/proprietário</Button>
                </>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {i > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setActivePapel(papeis[i - 1])}>
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Voltar
                </Button>
              )}
              {i < papeis.length - 1 && (
                <Button size="sm" variant="ghost" onClick={() => setActivePapel(papeis[i + 1])}>
                  Próximo bloco <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
          ),
        };})}
        current={activePapel}
        onChange={setActivePapel}
        hideNav
      />
    </div>
  );
}
