import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/vendas/lancamento/nova")({
  head: () => ({ meta: [{ title: "Novo Lançamento" }] }),
  component: NewLancamento,
});

function NewLancamento() {
  const { user, hasAny, loading: authLoading } = useAuth();
  const router = useRouter();
  const [imovelId, setImovelId] = useState("");
  const [construtoraNome, setConstrutoraNome] = useState("");
  const [construtoraCnpj, setConstrutoraCnpj] = useState("");
  const [loading, setLoading] = useState(false);
  const allowed = hasAny(["lancamento", "corretor", "gestor", "team_leader"]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    try {
      // sales + sale_parties (construtora/comprador) + o log de criação são gravados numa única
      // transação no banco (ver criar_lancamento em 20260818020000) — não depende mais de 3
      // chamadas soltas do client nem de um insert "fire-and-forget" que podia falhar em silêncio.
      const { data: saleId, error } = await supabase.rpc("criar_lancamento", {
        p_imovel_id: imovelId,
        p_construtora_nome: construtoraNome,
        p_construtora_cnpj: construtoraCnpj,
      });
      if (error) throw error;
      toast.success("Lançamento criado como rascunho");
      router.navigate({ to: "/vendas/$id", params: { id: saleId } });
    } catch (err: any) {
      if (err.code === "23505" && err.message?.includes("sales_imovel_id_ativa_key")) {
        toast.error("Já existe uma venda em andamento para esse código de imóvel.");
      } else {
        toast.error(err.message ?? "Falha ao criar lançamento");
      }
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (!allowed) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Você não possui um perfil autorizado para criar Lançamentos. Perfis autorizados:
          Lançamento, corretor, gestor ou Team Leader.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo Lançamento</h1>
        <p className="text-sm text-muted-foreground">
          Fluxo específico para venda em parceria com construtora — sem documentos e sem etapa do
          Jurídico. Pode ser criado pelos perfis Lançamento, corretor, gestor ou Team Leader.
          Comece identificando o imóvel e a construtora; o restante é preenchido na próxima tela.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Identificação</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="space-y-4">
            <div>
              <Label htmlFor="imovel">Código do imóvel</Label>
              <Input
                id="imovel"
                value={imovelId}
                onChange={(e) => setImovelId(e.target.value)}
                placeholder="Ex: 630601112-229"
              />
            </div>
            <div>
              <Label htmlFor="construtora-nome">Nome da construtora</Label>
              <Input
                id="construtora-nome"
                value={construtoraNome}
                onChange={(e) => setConstrutoraNome(e.target.value)}
                placeholder="Ex: Alphaville"
              />
            </div>
            <div>
              <Label htmlFor="construtora-cnpj">CNPJ da construtora</Label>
              <Input
                id="construtora-cnpj"
                value={construtoraCnpj}
                onChange={(e) => setConstrutoraCnpj(e.target.value)}
                placeholder="00.000.000/0000-00"
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? "Criando..." : "Criar rascunho"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
