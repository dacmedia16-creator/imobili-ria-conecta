import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { lerGoogleAvaliacao, salvarGoogleAvaliacao } from "@/lib/link-acompanhamento-db";

/**
 * "Link de avaliação no Google" no cadastro da imobiliária (t_54c79bdc). Cartão próprio, com RPC própria
 * (agency_google_avaliacao_salvar): não passa pelo "Salvar dados e cores" nem mexe nos outros campos.
 * Aparece no link de acompanhamento do cliente só quando o contrato está assinado. Vazio = sem botão.
 */
export function GoogleAvaliacaoCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const [valor, setValor] = useState("");
  const [salvo, setSalvo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void lerGoogleAvaliacao(orgId).then((v) => {
      setValor(v);
      setSalvo(v);
    });
  }, [orgId]);

  const salvar = async () => {
    setSaving(true);
    try {
      const v = await salvarGoogleAvaliacao(valor);
      setValor(v);
      setSalvo(v);
      toast.success(
        v ? "Link de avaliação no Google salvo." : "Link de avaliação no Google removido.",
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o link.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Avaliação no Google</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="agency-google-avaliacao">Link de avaliação no Google</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="agency-google-avaliacao"
            className="min-w-0 flex-1"
            type="url"
            inputMode="url"
            maxLength={500}
            placeholder="https://g.page/r/…/review"
            value={valor}
            disabled={!canEdit}
            onChange={(e) => setValor(e.target.value)}
          />
          <Button onClick={salvar} disabled={saving || !canEdit || valor.trim() === salvo}>
            {saving ? "Salvando…" : "Salvar link"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Aparece como botão “Avaliar no Google” no link de acompanhamento do cliente quando o
          contrato é assinado. Vazio, o botão não aparece.
        </p>
      </CardContent>
    </Card>
  );
}
