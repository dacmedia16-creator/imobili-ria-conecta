import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BrandHeroBackground } from "@/components/BrandHeroBackground";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { LOGIN_SO_GOOGLE } from "@/lib/login-so-google";

export const Route = createFileRoute("/redefinir-senha")({
  ssr: false,
  head: () => ({ meta: [{ title: "Redefinir senha — Portal Imobiliária" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
    // Login só com Google (t_93e80346): "Esqueci/Redefinir senha" desativado.
    if (LOGIN_SO_GOOGLE) throw redirect({ to: "/dashboard" });
  },
  component: RedefinirSenhaPage,
});

function RedefinirSenhaPage() {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [loading, setLoading] = useState(false);
  const [fieldError, setFieldError] = useState<{
    field: "nova-senha" | "confirmar-senha";
    message: string;
  } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (senha.length < 8) {
      e.currentTarget.querySelector<HTMLInputElement>("#nova-senha")?.focus();
      setFieldError({ field: "nova-senha", message: "Use pelo menos 8 caracteres." });
      return;
    }
    if (senha !== confirmacao) {
      e.currentTarget.querySelector<HTMLInputElement>("#confirmar-senha")?.focus();
      setFieldError({ field: "confirmar-senha", message: "As senhas não coincidem." });
      return;
    }
    setFieldError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      toast.success("Senha redefinida!");
      router.navigate({ to: "/dashboard", replace: true });
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Falha ao redefinir a senha"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-4">
      <BrandHeroBackground />
      {/* Marca neutra antes do login (t_475d2778). */}
      <div className="relative z-10 mb-6 text-2xl font-bold text-white">ADM MAX</div>
      <Card className="relative z-10 w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <KeyRound className="mx-auto h-8 w-8 text-primary" />
          <CardTitle>Redefinir senha</CardTitle>
          <CardDescription>Defina uma nova senha para sua conta.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="nova-senha">Nova senha</Label>
              <Input
                id="nova-senha"
                aria-invalid={fieldError?.field === "nova-senha"}
                aria-describedby={
                  fieldError?.field === "nova-senha" ? "nova-senha-erro" : undefined
                }
                autoComplete="new-password"
                type="password"
                value={senha}
                onChange={(e) => {
                  setSenha(e.target.value);
                  setFieldError(null);
                }}
                required
                minLength={8}
              />
              {fieldError?.field === "nova-senha" && (
                <p id="nova-senha-erro" role="alert" className="mt-1 text-sm text-destructive">
                  {fieldError.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="confirmar-senha">Confirmar nova senha</Label>
              <Input
                id="confirmar-senha"
                aria-invalid={fieldError?.field === "confirmar-senha"}
                aria-describedby={
                  fieldError?.field === "confirmar-senha" ? "confirmar-senha-erro" : undefined
                }
                autoComplete="new-password"
                type="password"
                value={confirmacao}
                onChange={(e) => {
                  setConfirmacao(e.target.value);
                  setFieldError(null);
                }}
                required
                minLength={8}
              />
              {fieldError?.field === "confirmar-senha" && (
                <p id="confirmar-senha-erro" role="alert" className="mt-1 text-sm text-destructive">
                  {fieldError.message}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Salvando…" : "Redefinir senha"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
