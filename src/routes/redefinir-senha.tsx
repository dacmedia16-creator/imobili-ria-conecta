import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

export const Route = createFileRoute("/redefinir-senha")({
  ssr: false,
  head: () => ({ meta: [{ title: "Redefinir senha — Portal Imobiliária" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
  },
  component: RedefinirSenhaPage,
});

function RedefinirSenhaPage() {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (senha.length < 8) {
      toast.error("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (senha !== confirmacao) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      toast.success("Senha redefinida!");
      router.navigate({ to: "/", replace: true });
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao redefinir a senha");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <KeyRound className="mx-auto h-8 w-8 text-primary" />
          <CardTitle>Redefinir senha</CardTitle>
          <CardDescription>Defina uma nova senha para sua conta.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="nova-senha">Nova senha</Label>
              <Input id="nova-senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={8} />
            </div>
            <div>
              <Label htmlFor="confirmar-senha">Confirmar nova senha</Label>
              <Input id="confirmar-senha" type="password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} required minLength={8} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Salvando..." : "Redefinir senha"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
