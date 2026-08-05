import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/vendas/nova")({
  head: () => ({ meta: [{ title: "Nova Venda" }] }),
  component: NewSale,
});

function NewSale() {
  const { user } = useAuth();
  const router = useRouter();
  const [imovelId, setImovelId] = useState("");
  const [tipoPessoaVendedor, setTipoPessoaVendedor] = useState<"fisica" | "juridica">("fisica");
  const [tipoPessoaComprador, setTipoPessoaComprador] = useState<"fisica" | "juridica">("fisica");
  const [loading, setLoading] = useState(false);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("sales")
        .insert({ corretor_id: user.id, imovel_id: imovelId || null, status: "rascunho" })
        .select("id")
        .single();
      if (error) throw error;
      // Já cria as partes principais (vendedor 1 e comprador 1) com o tipo escolhido aqui — na
      // etapa Partes os cards abrem prontos (física ou jurídica), sem escolher de novo.
      const { error: partyErr } = await supabase.from("sale_parties").insert([
        { sale_id: data.id, papel: "vendedor_1", tipo_pessoa: tipoPessoaVendedor },
        { sale_id: data.id, papel: "comprador_1", tipo_pessoa: tipoPessoaComprador },
      ]);
      if (partyErr) throw partyErr;
      toast.success("Venda criada como rascunho");
      router.navigate({ to: "/vendas/$id", params: { id: data.id } });
    } catch (err: any) {
      if (err.code === "23505" && err.message?.includes("sales_imovel_id_ativa_key")) {
        toast.error("Já existe uma venda em andamento para esse código de imóvel.");
      } else {
        toast.error(err.message ?? "Falha ao criar venda");
      }
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
              <Label htmlFor="tipo-pessoa-vendedor">Tipo de pessoa (vendedor/proprietário)</Label>
              <Select value={tipoPessoaVendedor} onValueChange={(v) => setTipoPessoaVendedor(v as "fisica" | "juridica")}>
                <SelectTrigger id="tipo-pessoa-vendedor"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fisica">Pessoa física</SelectItem>
                  <SelectItem value="juridica">Pessoa jurídica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tipo-pessoa-comprador">Tipo de pessoa (comprador)</Label>
              <Select value={tipoPessoaComprador} onValueChange={(v) => setTipoPessoaComprador(v as "fisica" | "juridica")}>
                <SelectTrigger id="tipo-pessoa-comprador"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fisica">Pessoa física</SelectItem>
                  <SelectItem value="juridica">Pessoa jurídica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={loading}>{loading ? "Criando..." : "Criar rascunho"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
