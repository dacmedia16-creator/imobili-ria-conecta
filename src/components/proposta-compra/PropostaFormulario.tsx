import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/visual/base";
import {
  ESTADOS_CIVIS,
  FORMAS_PAGAMENTO,
  FORMA_LABEL,
  SINAL_TIPO_LABEL,
  precisaConjuge,
} from "@/lib/proposta-compra";
import {
  CERTIDOES_LABEL,
  ESTADO_CIVIL_LABEL,
  ajustarConjuges,
  rotuloParte,
  type Imovel,
  type ParteForm,
  type PropostaForm,
} from "@/lib/proposta-compra-tela";

const SELECT =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-base disabled:opacity-70";
const AUTO = new Set(["captacao", "lead", "perfil"]);

function Campo({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * "Nova proposta" (t_da0dac53): imóvel e vendedores vêm da captação, comprador do lead do CRM (se houver).
 * O corretor completa o resto. D7: sinal sempre arras confirmatórias (sem campo de escolha).
 */
export function PropostaFormulario({
  form,
  onChange,
  imovel,
  corretor,
  disabled,
}: {
  form: PropostaForm;
  onChange: (f: PropostaForm) => void;
  imovel: Imovel;
  corretor: string | null;
  disabled: boolean;
}) {
  const set = <K extends keyof PropostaForm>(k: K, v: PropostaForm[K]) =>
    onChange({ ...form, [k]: v });
  const totalVendedores = useMemo(
    () => form.partes.filter((p) => p.papel === "vendedor").length,
    [form.partes],
  );
  const setParte = (i: number, patch: Partial<ParteForm>) => {
    const partes = form.partes.map((p, j) => (j === i ? { ...p, ...patch } : p));
    onChange({ ...form, partes: ajustarConjuges(partes) });
  };
  const temSinal =
    form.formaPagamento === "sinal_financiamento" || form.formaPagamento === "sinal_parcelas";
  const endereco = [
    imovel.endereco,
    imovel.complemento,
    imovel.bairro,
    [imovel.cidade, imovel.uf].filter(Boolean).join("/"),
  ]
    .filter((x) => x && x.trim())
    .join(", ");

  return (
    <div className="space-y-4" data-testid="form-proposta">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Imóvel <Pill tom="green">preenchido pela captação</Pill>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Endereço: </span>
            {[imovel.tipo, endereco].filter(Boolean).join(" · ") || "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Matrícula: </span>
            {[imovel.matricula, imovel.cartorio].filter(Boolean).join(" · ") || "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Preço anunciado: </span>
            {imovel.valor_anunciado ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Corretor do negócio: </span>
            {corretor ?? "—"}
          </p>
        </CardContent>
      </Card>

      {form.partes.map((p, i) => {
        const conj = p.papel.endsWith("_conjuge");
        const pid = `parte-${p.papel}-${p.ordem}`;
        return (
          <Card key={`${p.papel}-${p.ordem}`} data-testid={pid}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {rotuloParte(p.papel, p.ordem, totalVendedores)}
                {AUTO.has(p.origem) && (
                  <Pill tom="green">
                    {p.origem === "lead" ? "veio do CRM" : "preenchido pela captação"}
                  </Pill>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {!conj && (
                <Campo id={`${pid}-tipo`} label="Tipo">
                  <select
                    id={`${pid}-tipo`}
                    className={SELECT}
                    disabled={disabled}
                    value={p.tipoPessoa}
                    onChange={(e) =>
                      setParte(i, { tipoPessoa: e.target.value as ParteForm["tipoPessoa"] })
                    }
                  >
                    <option value="fisica">Pessoa física</option>
                    <option value="juridica">Empresa (PJ)</option>
                  </select>
                </Campo>
              )}
              <Campo
                id={`${pid}-nome`}
                label={p.tipoPessoa === "juridica" ? "Razão social" : "Nome completo"}
              >
                <Input
                  id={`${pid}-nome`}
                  disabled={disabled}
                  value={p.nome}
                  maxLength={160}
                  onChange={(e) => setParte(i, { nome: e.target.value })}
                />
              </Campo>
              <Campo id={`${pid}-doc`} label={p.tipoPessoa === "juridica" ? "CNPJ" : "CPF"}>
                <Input
                  id={`${pid}-doc`}
                  inputMode="numeric"
                  disabled={disabled}
                  value={p.cpfCnpj}
                  maxLength={18}
                  onChange={(e) => setParte(i, { cpfCnpj: e.target.value })}
                />
              </Campo>
              {p.tipoPessoa === "fisica" && !conj && (
                <Campo id={`${pid}-ec`} label="Estado civil">
                  <select
                    id={`${pid}-ec`}
                    className={SELECT}
                    disabled={disabled}
                    value={p.estadoCivil}
                    onChange={(e) =>
                      setParte(i, { estadoCivil: e.target.value as ParteForm["estadoCivil"] })
                    }
                  >
                    <option value="">Selecione</option>
                    {ESTADOS_CIVIS.map((ec) => (
                      <option key={ec} value={ec}>
                        {ESTADO_CIVIL_LABEL[ec]}
                      </option>
                    ))}
                  </select>
                </Campo>
              )}
              <Campo id={`${pid}-tel`} label="Celular (WhatsApp para assinar)">
                <Input
                  id={`${pid}-tel`}
                  inputMode="tel"
                  disabled={disabled}
                  value={p.telefone}
                  maxLength={20}
                  onChange={(e) => setParte(i, { telefone: e.target.value })}
                />
              </Campo>
              <Campo id={`${pid}-email`} label="E-mail">
                <Input
                  id={`${pid}-email`}
                  type="email"
                  disabled={disabled}
                  value={p.email}
                  maxLength={160}
                  onChange={(e) => setParte(i, { email: e.target.value })}
                />
              </Campo>
              {!conj && p.tipoPessoa === "fisica" && precisaConjuge(p.estadoCivil) && (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Casado(a) ou união estável: o cônjuge também assina (bloco logo abaixo).
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Valores e pagamento</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Campo id="valor-oferta" label="Valor oferecido (R$)">
            <Input
              id="valor-oferta"
              inputMode="decimal"
              disabled={disabled}
              value={form.valorOferta}
              onChange={(e) => set("valorOferta", e.target.value)}
            />
          </Campo>
          <Campo id="forma-pagamento" label="Forma de pagamento">
            <select
              id="forma-pagamento"
              className={SELECT}
              disabled={disabled}
              value={form.formaPagamento}
              onChange={(e) =>
                set("formaPagamento", e.target.value as PropostaForm["formaPagamento"])
              }
            >
              <option value="">Selecione</option>
              {FORMAS_PAGAMENTO.map((f) => (
                <option key={f} value={f}>
                  {FORMA_LABEL[f]}
                </option>
              ))}
            </select>
          </Campo>
          {temSinal && (
            <>
              <Campo id="sinal-valor" label="Sinal (R$)">
                <Input
                  id="sinal-valor"
                  inputMode="decimal"
                  disabled={disabled}
                  value={form.sinalValor}
                  onChange={(e) => set("sinalValor", e.target.value)}
                />
              </Campo>
              <Campo id="sinal-prazo" label="Prazo para pagar o sinal (dias)">
                <Input
                  id="sinal-prazo"
                  inputMode="numeric"
                  disabled={disabled}
                  value={form.sinalPrazoDias}
                  onChange={(e) => set("sinalPrazoDias", e.target.value)}
                />
              </Campo>
              <p className="text-xs text-muted-foreground sm:col-span-2" data-testid="sinal-tipo">
                Tipo do sinal: <strong>{SINAL_TIPO_LABEL}</strong> (padrão da imobiliária).
              </p>
            </>
          )}
          {form.formaPagamento === "sinal_financiamento" && (
            <>
              <Campo id="fin-banco" label="Banco do financiamento">
                <Input
                  id="fin-banco"
                  disabled={disabled}
                  value={form.financiamentoBanco}
                  maxLength={80}
                  onChange={(e) => set("financiamentoBanco", e.target.value)}
                />
              </Campo>
              <Campo id="fin-valor" label="Valor financiado (R$)">
                <Input
                  id="fin-valor"
                  inputMode="decimal"
                  disabled={disabled}
                  value={form.financiamentoValor}
                  onChange={(e) => set("financiamentoValor", e.target.value)}
                />
              </Campo>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Condições</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Campo id="validade" label="Validade da proposta (dias corridos)">
            <Input
              id="validade"
              inputMode="numeric"
              disabled={disabled}
              value={form.validadeDias}
              onChange={(e) => set("validadeDias", e.target.value)}
            />
          </Campo>
          <Campo id="prazo-contrato" label="Prazo para assinar o contrato (dias)">
            <Input
              id="prazo-contrato"
              inputMode="numeric"
              disabled={disabled}
              value={form.prazoContratoDias}
              onChange={(e) => set("prazoContratoDias", e.target.value)}
            />
          </Campo>
          <Campo id="certidoes" label="Certidões">
            <select
              id="certidoes"
              className={SELECT}
              disabled={disabled}
              value={form.certidoes}
              onChange={(e) => set("certidoes", e.target.value as PropostaForm["certidoes"])}
            >
              <option value="">Selecione</option>
              {(Object.keys(CERTIDOES_LABEL) as (keyof typeof CERTIDOES_LABEL)[]).map((k) => (
                <option key={k} value={k}>
                  {CERTIDOES_LABEL[k]}
                </option>
              ))}
            </select>
          </Campo>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="observacoes">Observações</Label>
            <Textarea
              id="observacoes"
              disabled={disabled}
              value={form.observacoes}
              maxLength={2000}
              onChange={(e) => set("observacoes", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
