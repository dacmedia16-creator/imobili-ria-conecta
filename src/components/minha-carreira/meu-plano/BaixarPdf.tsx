import { useState } from "react";
import { toast } from "sonner";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Trilha } from "@/lib/meu-plano-2027/telas";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import { baixarPlanoPdf } from "@/lib/meu-plano-2027/baixar";
import { planoFinalizado } from "@/lib/meu-plano-2027/pdf-conteudo";

/**
 * Botão "Baixar meu plano em PDF". Só aparece com o plano finalizado (todas as telas da trilha completas).
 * `antes` roda primeiro (ex.: enviar o que ainda está na fila do aparelho).
 */
export function BotaoBaixarPlano({
  userId,
  nome,
  S,
  trilha,
  rotulo = "Baixar meu plano em PDF",
  antes,
  className,
}: {
  userId: string;
  nome?: string | null;
  S: Respostas;
  trilha: Trilha | null;
  rotulo?: string;
  antes?: () => Promise<unknown>;
  className?: string;
}) {
  const [ocupado, setOcupado] = useState(false);
  if (!planoFinalizado(S, trilha)) return null;
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
