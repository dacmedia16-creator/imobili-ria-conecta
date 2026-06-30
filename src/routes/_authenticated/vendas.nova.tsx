import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/vendas/nova")({
  head: () => ({ meta: [{ title: "Nova Venda" }] }),
  component: NewSale,
});

function NewSale() {
  const { user } = useAuth();
  const router = useRouter();
  const [imovelId, setImovelId] = useState("");
  const [matricula, setMatricula] = useState("");
  const [loading, setLoading] = useState(false);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("sales")
        .insert({ corretor_id: user.id, imovel_id: imovelId || null, matricula: matricula || null, status: "rascunho" })
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Venda criada como rascunho");
      router.navigate({ to: "/vendas/$id", params: { id: data.id } });
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao criar venda");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nova venda</h1>
        <p className="text-sm text-muted-foreground">Comece informando o imóvel. Você poderá preencher todos os dados depois.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Identificação do imóvel</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="space-y-4">
            <div>
              <Label htmlFor="imovel">ID do imóvel</Label>
              <Input id="imovel" value={imovelId} onChange={(e) => setImovelId(e.target.value)} placeholder="Ex: APT-001" />
            </div>
            <div>
              <Label htmlFor="mat">Matrícula</Label>
              <Input id="mat" value={matricula} onChange={(e) => setMatricula(e.target.value)} />
            </div>
            <Button type="submit" disabled={loading}>{loading ? "Criando..." : "Criar rascunho"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
