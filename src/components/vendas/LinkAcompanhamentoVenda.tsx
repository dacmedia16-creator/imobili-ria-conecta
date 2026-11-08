import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LADO_LABEL,
  juntarNomes,
  linkAcompanhamentoUrl,
  textoAberturas,
  type Lado,
  type LinksVenda,
} from "@/lib/link-acompanhamento";
import {
  carregarLinksVenda,
  linkAcompanhamentoEnabled,
  regenerarLinkVenda,
} from "@/lib/link-acompanhamento-db";

/**
 * Bloco "Link de acompanhamento" da venda (t_54c79bdc). Um link para o comprador e outro para o vendedor.
 * Só aparece com o módulo ligado e para quem já vê a venda (o banco confere; recusa = bloco some).
 * Envio é manual: o corretor copia e manda pelo WhatsApp dele. Nada é enviado automaticamente.
 */
export function LinkAcompanhamentoVenda({
  saleId,
  compradores,
  vendedores,
}: {
  saleId: string;
  compradores: string[];
  vendedores: string[];
}) {
  const [dados, setDados] = useState<LinksVenda | null>(null);
  const [confirmar, setConfirmar] = useState<Lado | null>(null);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    if (!(await linkAcompanhamentoEnabled())) return setDados(null);
    try {
      setDados(await carregarLinksVenda(saleId));
    } catch {
      setDados(null);
    }
  }, [saleId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!dados) return null;

  const copiar = async (token: string) => {
    const url = linkAcompanhamentoUrl(window.location.origin, token);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado. Mande pelo seu WhatsApp.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie manualmente.");
    }
  };

  const regenerar = async (lado: Lado) => {
    setBusy(true);
    try {
      setDados(await regenerarLinkVenda(saleId, lado));
      toast.success(`Link do ${LADO_LABEL[lado].toLowerCase()} trocado. O antigo não abre mais.`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar outro link.");
    } finally {
      setBusy(false);
      setConfirmar(null);
    }
  };

  const nomes: Record<Lado, string> = {
    comprador: juntarNomes(compradores),
    vendedor: juntarNomes(vendedores),
  };

  return (
    <Card className="print:hidden" data-testid="link-acompanhamento">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" /> Link de acompanhamento
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          O cliente acompanha o andamento até o contrato assinado, sem login. O link segue o status
          da venda sozinho e nunca mostra valores. Copie e mande pelo seu WhatsApp.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!dados.disponivel ? (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            Venda cancelada ou arquivada: os links não abrem mais. O cliente vê “Este link não está
            mais disponível. Fale com o seu corretor.”
          </p>
        ) : (
          dados.links.map((l) => {
            const url = linkAcompanhamentoUrl(window.location.origin, l.token);
            return (
              <div key={l.lado} className="rounded-lg border p-3" data-lado={l.lado}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 font-medium">
                    {LADO_LABEL[l.lado]}
                    {nomes[l.lado] && (
                      <span className="font-normal text-muted-foreground"> · {nomes[l.lado]}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{textoAberturas(l)}</span>
                </div>
                <code className="my-2 block break-all rounded bg-muted px-2 py-1 text-xs">
                  {url}
                </code>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void copiar(l.token)}>
                    <Copy className="mr-1 h-3.5 w-3.5" /> Copiar link
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-300 text-red-700 hover:bg-red-50"
                    disabled={busy}
                    onClick={() => setConfirmar(l.lado)}
                  >
                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> Desligar e gerar outro
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
      <AlertDialog open={confirmar !== null} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Desligar o link do {confirmar ? LADO_LABEL[confirmar].toLowerCase() : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O link atual para de abrir na hora e um novo é gerado. Você precisará mandar o novo
              link ao cliente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (confirmar) void regenerar(confirmar);
              }}
            >
              Desligar e gerar outro
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
