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
  const { user } = useAuth();
  const router = useRouter();
  const [imovelId, setImovelId] = useState("");
  const [construtoraNome, setConstrutoraNome] = useState("");
  const [construtoraCnpj, setConstrutoraCnpj] = useState("");
  const [loading, setLoading] = useState(false);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("sales")
        .insert({
          corretor_id: user.id,
          imovel_id: imovelId || null,
          status: "rascunho",
          modalidade: "lancamento",
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      // Construtora entra como vendedor_1 (pessoa jurídica) — sale_parties já suporta esse formato,
      // sem precisar de tabela/campo novo só pra isso.
      const { error: partyErr } = await supabase.from("sale_parties").insert([
        {
          sale_id: data.id,
          papel: "vendedor_1",
          tipo_pessoa: "juridica",
          razao_social: construtoraNome || null,
          cnpj: construtoraCnpj || null,
        },
        { sale_id: data.id, papel: "comprador_1", tipo_pessoa: "fisica" },
      ]);
      if (partyErr) throw partyErr;
      // Fire-and-forget: log de auditoria não pode impedir a navegação se falhar (a venda já foi
      // criada com sucesso nesse ponto).
      supabase
        .from("activity_logs")
        .insert({
          sale_id: data.id,
          autor_id: user.id,
          acao: "lancamento_criado",
          payload: { imovel_id: imovelId || null, construtora: construtoraNome || null },
        })
        .then(() => {});
      toast.success("Lançamento criado como rascunho");
      router.navigate({ to: "/vendas/$id", params: { id: data.id } });
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo Lançamento</h1>
        <p className="text-sm text-muted-foreground">
          Venda em parceria com construtora — sem documentos, sem jurídico. Comece identificando o
          imóvel e a construtora, o restante você preenche na próxima tela.
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
