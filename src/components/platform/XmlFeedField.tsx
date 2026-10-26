import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import {
  getOrganizationXmlFeed,
  saveOrganizationXmlFeed,
  testOrganizationXmlFeed,
} from "@/lib/platform-organizations.functions";

/**
 * "Link do XML (portais)" no Editar imobiliária (card t_76243950). Esta tela já é só do administrador da
 * plataforma, e o servidor confere de novo (platform_admins + RPC no banco). O teste baixa pelo servidor e
 * mostra só quantos imóveis vieram. Salvar o link faz a coleta de hora em hora começar a usá-lo.
 */
export function XmlFeedField({ organizationId }: { organizationId: string }) {
  const getFn = useServerFn(getOrganizationXmlFeed);
  const saveFn = useServerFn(saveOrganizationXmlFeed);
  const testFn = useServerFn(testOrganizationXmlFeed);
  const [url, setUrl] = useState("");
  const [salvo, setSalvo] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState<"salvar" | "testar" | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setResultado(null);
    getFn({ data: { organizationId } })
      .then((r) => {
        if (!vivo) return;
        setUrl(r.url);
        setSalvo(r.url);
      })
      .catch((e) => vivo && toast.error(errorMessage(e, "Não foi possível ler o link do XML")))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [getFn, organizationId]);

  const testar = async () => {
    setOcupado("testar");
    setResultado(null);
    try {
      const r = await testFn({ data: { url } });
      setResultado(
        r.ok
          ? `O XML trouxe ${r.total} imóve${r.total === 1 ? "l" : "is"} (${r.venda} de venda${r.aluguel ? `, ${r.aluguel} de aluguel, que não são usados` : ""}).`
          : r.erro,
      );
    } catch (e) {
      setResultado(errorMessage(e, "Não foi possível testar o link"));
    } finally {
      setOcupado(null);
    }
  };

  const salvar = async () => {
    setOcupado("salvar");
    try {
      await saveFn({ data: { organizationId, url } });
      setSalvo(url.trim());
      toast.success(url.trim() ? "Link do XML salvo" : "Link do XML removido");
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar o link do XML"));
    } finally {
      setOcupado(null);
    }
  };

  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Link do XML (portais)</legend>
      <Label htmlFor="org-xml-url" className="sr-only">
        Link do XML (portais)
      </Label>
      <Input
        id="org-xml-url"
        type="url"
        inputMode="url"
        placeholder="https://..."
        value={url}
        disabled={carregando}
        onChange={(e) => {
          setUrl(e.target.value);
          setResultado(null);
        }}
      />
      <p className="text-xs text-muted-foreground">
        Só https. O ADM baixa o XML pelo servidor de hora em hora e a IA de leads usa os dados do imóvel.
        Deixe vazio para não usar XML.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={carregando || !url.trim() || ocupado !== null}
          onClick={testar}
        >
          {ocupado === "testar" ? "Testando…" : "Testar link"}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={carregando || url.trim() === salvo || ocupado !== null}
          onClick={salvar}
        >
          {ocupado === "salvar" ? "Salvando…" : "Salvar link"}
        </Button>
      </div>
      {resultado && (
        <p role="status" className="text-sm">
          {resultado}
        </p>
      )}
    </fieldset>
  );
}
