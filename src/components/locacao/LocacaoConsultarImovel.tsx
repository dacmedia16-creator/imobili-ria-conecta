import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/visual/base";
import { errorMessage } from "@/lib/errors";
import {
  STATUS_CONSULTA,
  TERMO_MAXIMO,
  TERMO_MINIMO,
  detalheEtapa,
  lerConsulta,
  termoValido,
  type ImovelConsultado,
} from "@/lib/locacao-consulta";
import { consultarImovelLocacao } from "@/lib/locacao-db";

// "Consultar imóvel" (t_241e03a9): qualquer pessoa da imobiliária vê se o imóvel já tem processo de locação
// andando e com qual corretor. O banco limita à imobiliária atual, a 10 resultados e não devolve dados pessoais.
export function LocacaoConsultarImovel() {
  const [termo, setTermo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<ImovelConsultado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = async (e: FormEvent) => {
    e.preventDefault();
    const t = termoValido(termo);
    if (!t) {
      setErro(`Digite pelo menos ${TERMO_MINIMO} letras ou números do código ou do endereço.`);
      setResultado(null);
      return;
    }
    setBuscando(true);
    setErro(null);
    try {
      setResultado(lerConsulta(await consultarImovelLocacao(t)));
    } catch (err) {
      setResultado(null);
      setErro(errorMessage(err, "Não foi possível consultar o imóvel."));
    } finally {
      setBuscando(false);
    }
  };

  return (
    <Card data-testid="locacao-consultar-imovel">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Consultar imóvel</CardTitle>
        <p className="text-sm text-muted-foreground">
          Veja se o imóvel já tem processo de locação andando, pelo código do imóvel ou pelo
          endereço.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={(e) => void buscar(e)} className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Código do imóvel ou endereço"
            placeholder="Código do imóvel ou parte do endereço"
            value={termo}
            maxLength={TERMO_MAXIMO}
            onChange={(e) => setTermo(e.target.value)}
          />
          <Button type="submit" disabled={buscando}>
            <Search className="mr-1 h-4 w-4" /> {buscando ? "Consultando…" : "Consultar"}
          </Button>
        </form>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        {resultado && resultado.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="consulta-vazia">
            🟢 Nenhum processo de locação encontrado para esse código ou endereço. Confira se
            digitou certo.
          </p>
        )}
        {resultado && resultado.length > 0 && (
          <ul className="divide-y rounded-md border" data-testid="consulta-resultado">
            {resultado.map((i, n) => {
              const s = STATUS_CONSULTA[i.status];
              const etapa = detalheEtapa(i);
              return (
                <li
                  key={`${i.imovelId ?? ""}-${i.endereco ?? ""}-${n}`}
                  className="space-y-1 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {i.imovelId ? `Imóvel ${i.imovelId}` : "Imóvel sem código"}
                    </span>
                    <Pill tom={s.tom}>
                      {s.emoji} {s.label}
                    </Pill>
                  </div>
                  {i.endereco && <div className="text-muted-foreground">{i.endereco}</div>}
                  {i.corretor && (
                    <div>
                      Corretor responsável: <span className="font-medium">{i.corretor}</span>
                      {etapa && <span className="text-muted-foreground"> · {etapa}</span>}
                      {i.processosAtivos > 1 && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {i.processosAtivos} processos ativos
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {resultado && resultado.length >= 10 && (
          <p className="text-xs text-muted-foreground">
            A consulta mostra no máximo 10 imóveis. Digite mais do código ou do endereço para
            refinar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
