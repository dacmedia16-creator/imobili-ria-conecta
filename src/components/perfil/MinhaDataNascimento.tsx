import { useEffect, useState } from "react";
import { Cake } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DATA_NASCIMENTO_MIN,
  dataNascimentoMaxima,
  erroCampoDataNascimento,
} from "@/lib/data-nascimento";
import { minhaDataNascimento, salvarMinhaDataNascimento } from "@/lib/data-nascimento-db";

/**
 * "Data de nascimento" em Meu acesso (t_dff88e75). Opcional para quem já usa o sistema; enquanto
 * estiver vazia, aparece em destaque. Grava só a própria data (RPC profile_set_birthdate).
 */
export function MinhaDataNascimento({ userId }: { userId: string }) {
  const [salva, setSalva] = useState<string | null>(null);
  const [valor, setValor] = useState("");
  const [carregado, setCarregado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    minhaDataNascimento(userId)
      .then((d) => {
        if (!vivo) return;
        setSalva(d);
        setValor(d ?? "");
        setCarregado(true);
      })
      .catch(() => vivo && setCarregado(false));
    return () => {
      vivo = false;
    };
  }, [userId]);

  const erro = valor ? erroCampoDataNascimento(valor, false) : null;
  const vazia = carregado && !salva;

  const salvar = async () => {
    if (erro) {
      toast.error(erro);
      return;
    }
    setSalvando(true);
    try {
      const nova = valor.trim() || null;
      await salvarMinhaDataNascimento(nova);
      setSalva(nova);
      toast.success(nova ? "Data de nascimento salva" : "Data de nascimento removida");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar agora.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div
      className={
        vazia
          ? "max-w-sm rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30"
          : "max-w-sm"
      }
      data-testid="perfil-nascimento"
    >
      <Label
        htmlFor="perfil-nascimento"
        className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Cake className="h-3.5 w-3.5" aria-hidden /> Data de nascimento
      </Label>
      <div className="flex gap-2">
        <Input
          id="perfil-nascimento"
          type="date"
          autoComplete="bday"
          min={DATA_NASCIMENTO_MIN}
          max={dataNascimentoMaxima()}
          value={valor}
          disabled={!carregado}
          aria-invalid={Boolean(erro)}
          onChange={(e) => setValor(e.target.value)}
        />
        <Button
          size="sm"
          onClick={salvar}
          disabled={!carregado || salvando || (valor || null) === salva}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </Button>
      </div>
      {erro ? (
        <p className="mt-1.5 text-xs text-destructive">{erro}</p>
      ) : vazia ? (
        <p className="mt-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          Preencha sua data de nascimento para a equipe lembrar do seu aniversário.
        </p>
      ) : null}
      <p className="mt-1.5 text-xs text-muted-foreground">
        Os colegas veem só o dia e o mês. O ano e a idade ficam só com você e a gestão da
        imobiliária.
      </p>
    </div>
  );
}
