import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function DescricaoMatricula({ saleId, value, origem, editable, canCorrect, onChange, onSaved }: {
  saleId: string;
  value: string | null;
  origem: string;
  editable: boolean;
  canCorrect: boolean;
  onChange: (value: string) => void;
  onSaved: () => Promise<void>;
}) {
  const locked = origem === "ia_matricula";
  const [correcting, setCorrecting] = useState(false);
  const [text, setText] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value ?? ""); toast.success("Descrição copiada"); }
    catch { toast.error("Não foi possível copiar"); }
  };
  const save = async () => {
    if (!text.trim()) { toast.error("Informe a descrição corrigida"); return; }
    setSaving(true);
    try {
      const { data: saved, error } = await supabase.rpc("corrigir_descricao_matricula", { _sale_id: saleId, _descricao: text.trim() });
      if (error) throw error;
      if (!saved) { toast.error("Correção não autorizada ou descrição inalterada"); return; }
      await onSaved();
      setCorrecting(false);
      toast.success("Correção registrada com usuário e data");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao corrigir descrição"); }
    finally { setSaving(false); }
  };
  return <div className="space-y-2">
    <Textarea value={correcting ? text : value ?? ""} rows={4}
      disabled={saving || (!correcting && (!editable || locked))}
      onChange={(e) => correcting ? setText(e.target.value) : onChange(e.target.value)}
      placeholder="Descrição extraída da matrícula" />
    <div className="flex gap-2 print:hidden">
      <Button type="button" variant="outline" size="sm" onClick={copy} disabled={!value}>Copiar descrição</Button>
      {locked && canCorrect && !correcting && <Button type="button" variant="outline" size="sm" onClick={() => { setText(value ?? ""); setCorrecting(true); }}>Corrigir descrição</Button>}
      {correcting && <><Button type="button" size="sm" disabled={saving} onClick={save}>Salvar correção</Button><Button type="button" variant="ghost" size="sm" onClick={() => setCorrecting(false)}>Cancelar</Button></>}
    </div>
    {locked && <p className="text-xs text-muted-foreground">Descrição da matrícula protegida. Somente jurídico ou administrador da imobiliária pode corrigir.</p>}
  </div>;
}
