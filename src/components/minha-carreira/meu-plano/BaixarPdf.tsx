import { useState } from "react";
import { toast } from "sonner";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import { baixarPlanoPdf } from "@/lib/meu-plano-2027/baixar";

/**
 * Botão "Baixar meu plano em PDF". Aparece sempre, mesmo com o plano incompleto (t_b8aae132): o PDF sai com o
 * que estiver preenchido e a linha "Plano X% preenchido (Y de 26 telas)".
 * `antes` roda primeiro (ex.: enviar o que ainda está na fila do aparelho).
 */
export function BotaoBaixarPlano({
  userId,
  nome,
  S,
  rotulo = "Baixar meu plano em PDF",
  antes,
  className,
}: {
  userId: string;
  nome?: string | null;
  S: Respostas;
  rotulo?: string;
  antes?: () => Promise<unknown>;
  className?: string;
}) {
  const [ocupado, setOcupado] = useState(false);
  async function baixar() {
    setOcupado(true);
    try {
      if (antes) await antes();
      await baixarPlanoPdf(userId, nome);
      toast.success("PDF do plano baixado.");
    } catch (e) {
      toast.error((e as Error).message || "Não foi possível gerar o PDF.");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <Button
      variant="outline"
      className={className ?? "w-full"}
      disabled={ocupado}
      onClick={() => void baixar()}
      data-testid="baixar-plano-pdf"
    >
      {ocupado ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <FileDown className="mr-2 h-4 w-4" aria-hidden />
      )}
      {rotulo}
    </Button>
  );
}
