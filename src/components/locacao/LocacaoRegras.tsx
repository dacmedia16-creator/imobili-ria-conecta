import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AConfirmar } from "@/components/locacao/LocacaoDetalhe";
import { errorMessage } from "@/lib/errors";
import { docsParaTexto, textoParaDocs, type ConfigLocacao } from "@/lib/locacao";
import { definirPapelLocacao, listarPapeisLocacao, salvarConfigLocacao } from "@/lib/locacao-db";

const PAPEIS = [
  { key: "gestora", label: "Gestora de locação" },
  { key: "contratos", label: "Setor de contratos" },
  { key: "vistoria", label: "Vistoria/Seguro" },
] as const;

type Pessoa = { userId: string; nome: string; papeis: string[] };

/** Papéis e regras da locação (só administração/staff; o banco repete a checagem). */
export function LocacaoRegras({ config, onSalvo }: { config: ConfigLocacao; onSalvo: () => void }) {
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [f, setF] = useState(() => ({ ...config, docsTexto: docsParaTexto(config.documentos) }));
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const raw = await listarPapeisLocacao();
      setPessoas(
        (Array.isArray(raw) ? raw : []).map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return {
            userId: String(o.user_id ?? ""),
            nome: String(o.nome ?? ""),
            papeis: Array.isArray(o.papeis) ? o.papeis.map(String) : [],
          };
        }),
      );
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível carregar a equipe."));
    }
  }, []);
  useEffect(() => void carregar(), [carregar]);

  const alternar = async (p: Pessoa, papel: string, ativo: boolean) => {
    setBusy(true);
    try {
      await definirPapelLocacao(p.userId, papel, ativo);
      await carregar();
      onSalvo();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível alterar o papel."));
    } finally {
      setBusy(false);
    }
  };

  const salvar = async () => {
    setBusy(true);
    try {
      await salvarConfigLocacao({
        pct_coordenador: Number(f.pctCoordenador),
        coordenador_sai_do_corretor: f.coordenadorSaiDoCorretor,
        parceria_divide_por_dois: f.parceriaDividePorDois,
        coordenador_na_parceria: f.coordenadorNaParceria,
        dia_pagamento_1a15: Number(f.diaPagamento1a15),
        dia_pagamento_16a31: Number(f.diaPagamento16a31),
        reprovada_volta_ao_corretor: f.reprovadaVoltaAoCorretor,
        chave_antes_do_laudo: f.chaveAntesDoLaudo,
        seguro_incendio_obrigatorio: f.seguroIncendioObrigatorio,
        documentos: textoParaDocs(f.docsTexto),
      });
      toast.success("Regras salvas");
      onSalvo();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar as regras."));
    } finally {
      setBusy(false);
    }
  };

  const chk = (k: keyof ConfigLocacao, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={Boolean(f[k])}
        onChange={(e) => setF((x) => ({ ...x, [k]: e.target.checked }))}
      />
      {label} <AConfirmar />
    </label>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quem faz cada papel</CardTitle>
          <p className="text-sm text-muted-foreground">
            Administrador e administrador principal podem agir em qualquer papel. Uma pessoa pode
            ter mais de um papel.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!pessoas ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <table className="w-full text-sm" data-testid="locacao-papeis">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1">Pessoa</th>
                  {PAPEIS.map((p) => (
                    <th key={p.key} className="text-center">
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pessoas.map((p) => (
                  <tr key={p.userId} className="border-t">
                    <td className="py-1.5">{p.nome}</td>
                    {PAPEIS.map((papel) => (
                      <td key={papel.key} className="text-center">
                        <input
                          type="checkbox"
                          aria-label={`${papel.label}: ${p.nome}`}
                          disabled={busy}
                          checked={p.papeis.includes(papel.key)}
                          onChange={(e) => void alternar(p, papel.key, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regras desta imobiliária</CardTitle>
          <p className="text-sm text-muted-foreground">
            Valores iniciais da maquete aprovada. Os marcados <AConfirmar /> ainda dependem da
            confirmação do Denis.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cfg-coord">
              % do coordenador sobre a comissão <AConfirmar />
            </Label>
            <Input
              id="cfg-coord"
              inputMode="decimal"
              value={String(f.pctCoordenador)}
              onChange={(e) =>
                setF((x) => ({
                  ...x,
                  pctCoordenador: Number(e.target.value.replace(",", ".")) || 0,
                }))
              }
            />
          </div>
          <div className="space-y-2 pt-6">
            {chk("coordenadorSaiDoCorretor", "Parte do coordenador sai da parte do corretor")}
            {chk("coordenadorNaParceria", "Coordenador também recebe em parceria")}
            {chk("parceriaDividePorDois", "Parceria: aluguel ÷ 2 × %")}
          </div>
          <div className="space-y-1">
            <Label htmlFor="cfg-d1">
              Chave entregue de 1 a 15 → paga no dia <AConfirmar />
            </Label>
            <Input
              id="cfg-d1"
              inputMode="numeric"
              value={String(f.diaPagamento1a15)}
              onChange={(e) =>
                setF((x) => ({ ...x, diaPagamento1a15: Number(e.target.value) || 0 }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cfg-d2">
              Chave entregue de 16 a 31 → paga no dia <AConfirmar />
            </Label>
            <Input
              id="cfg-d2"
              inputMode="numeric"
              value={String(f.diaPagamento16a31)}
              onChange={(e) =>
                setF((x) => ({ ...x, diaPagamento16a31: Number(e.target.value) || 0 }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Houve menção a “dia 23”: basta pôr 23 nos dois campos.
            </p>
          </div>
          <div className="space-y-2">
            {chk(
              "reprovadaVoltaAoCorretor",
              "Pré-análise reprovada volta ao corretor (desmarcado = encerra)",
            )}
            {chk(
              "chaveAntesDoLaudo",
              "Permite entregar a chave antes do laudo assinado (com alerta)",
            )}
            {chk("seguroIncendioObrigatorio", "Seguro incêndio obrigatório antes das chaves")}
          </div>
          <div className="space-y-1 text-sm">
            <b>Taxa de administração → % do 1º aluguel</b>
            <p className="text-muted-foreground">
              {Object.entries(f.tabelaTaxa)
                .sort((a, b) => Number(b[0]) - Number(a[0]))
                .map(([t, p]) => `${t}% → ${p}%`)
                .join(" · ")}
            </p>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="cfg-docs">
              Documentos por garantia (um por linha; título do grupo entre colchetes) <AConfirmar />
            </Label>
            <Textarea
              id="cfg-docs"
              rows={14}
              className="font-mono text-xs"
              value={f.docsTexto}
              onChange={(e) => setF((x) => ({ ...x, docsTexto: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button disabled={busy} onClick={() => void salvar()}>
              Salvar regras
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
