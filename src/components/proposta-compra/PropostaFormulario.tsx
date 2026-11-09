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
  SINAL_TIPOS,
  SINAL_TIPO_AJUDA,
  SINAL_TIPO_LABEL,
  precisaConjuge,
  type TermoNumero,
  type TermoTexto,
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

// Opções iguais às da Campolim (texto oficial, t_b4e7c368).
const REGIMES = [
  "comunhão parcial de bens",
  "comunhão universal de bens",
  "separação total de bens",
  "participação final nos aquestos",
];
const FORMAS_SINAL = ["PIX", "transferência bancária (TED)", "cheque", "dinheiro"];
const COMISSAO = ["vendedor(a)", "comprador(a)", "conforme a autorização de venda"];

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
 * "Nova proposta" (t_da0dac53; texto oficial t_b4e7c368): imóvel e vendedores vêm da captação, comprador do lead
 * do CRM (se houver). O corretor completa o resto, inclusive os campos do texto oficial (Campolim ajustado).
 * D7 revista: o corretor escolhe o tipo de sinal (confirmatório = padrão, ou com direito de arrependimento).
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
  const termo = (k: TermoTexto | TermoNumero) => form.termos[k] ?? "";
  const setTermo = (k: TermoTexto | TermoNumero, v: string) =>
    onChange({ ...form, termos: { ...form.termos, [k]: v } });
  const texto = (k: TermoTexto | TermoNumero, label: string, max: number, ph?: string) => (
    <Campo id={`termo-${k}`} label={label}>
      <Input
        id={`termo-${k}`}
        disabled={disabled}
        value={termo(k)}
        maxLength={max}
        placeholder={ph}
        onChange={(e) => setTermo(k, e.target.value)}
      />
    </Campo>
  );
  const area = (k: TermoTexto, label: string, ph: string) => (
    <div className="space-y-1 sm:col-span-2">
      <Label htmlFor={`termo-${k}`}>{label}</Label>
      <Textarea
        id={`termo-${k}`}
        disabled={disabled}
        value={termo(k)}
        maxLength={900}
        placeholder={ph}
        onChange={(e) => setTermo(k, e.target.value)}
      />
    </div>
  );
  const lista = (k: TermoTexto, label: string, ops: string[], vazio?: string) => (
    <Campo id={`termo-${k}`} label={label}>
      <select
        id={`termo-${k}`}
        className={SELECT}
        disabled={disabled}
        value={termo(k)}
        onChange={(e) => setTermo(k, e.target.value)}
      >
        {vazio !== undefined && <option value="">{vazio}</option>}
        {ops.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Campo>
  );
  const temSinal =
    form.formaPagamento === "sinal_financiamento" || form.formaPagamento === "sinal_parcelas";
  const temFin = form.formaPagamento === "sinal_financiamento";
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
          {texto(
            "imovel_descricao",
            "Descrição do imóvel na proposta",
            300,
            imovel.tipo ?? "Ex.: Casa térrea com 3 dormitórios, 2 vagas",
          )}
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
              {p.papel === "comprador" && p.tipoPessoa === "fisica" && (
                <>
                  {texto("comprador_rg", "RG", 40)}
                  {texto("comprador_nacionalidade", "Nacionalidade", 60, "brasileira")}
                  {texto("comprador_profissao", "Profissão", 80)}
                  {precisaConjuge(p.estadoCivil) &&
                    lista("comprador_regime", "Regime de bens", REGIMES, "Selecione")}
                </>
              )}
              {p.papel === "comprador" && p.tipoPessoa === "juridica" && (
                <>
                  {texto("comprador_representante", "Representante legal (quem assina)", 160)}
                  {texto("comprador_representante_cpf", "CPF do representante", 14)}
                  {texto("comprador_cargo", "Cargo", 80, "sócio-administrador")}
                </>
              )}
              {p.papel === "comprador" && (
                <div className="sm:col-span-2">
                  {texto("comprador_endereco", "Endereço completo", 300)}
                </div>
              )}
              {p.papel === "vendedor" &&
                p.ordem === 1 &&
                temSinal &&
                texto(
                  "vendedor_conta",
                  "Conta do vendedor para o sinal (opcional)",
                  200,
                  "Ex.: PIX CPF do vendedor ou banco/agência/conta",
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
              <Campo id="sinal-prazo" label="Prazo do sinal (dias úteis após o aceite)">
                <Input
                  id="sinal-prazo"
                  inputMode="numeric"
                  disabled={disabled}
                  value={form.sinalPrazoDias}
                  onChange={(e) => set("sinalPrazoDias", e.target.value)}
                />
              </Campo>
              {lista("sinal_forma", "Forma do sinal", FORMAS_SINAL)}
            </>
          )}
          <fieldset className="space-y-2 sm:col-span-2" data-testid="sinal-tipo">
            <legend className="text-sm font-medium">Tipo de sinal</legend>
            {SINAL_TIPOS.map((t) => (
              <label key={t} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="sinal-tipo"
                  value={t}
                  className="mt-1 h-4 w-4"
                  disabled={disabled}
                  checked={form.sinalTipo === t}
                  onChange={() => set("sinalTipo", t)}
                  data-testid={`sinal-tipo-${t}`}
                />
                <span>
                  <strong>{SINAL_TIPO_LABEL[t]}</strong>: {SINAL_TIPO_AJUDA[t]}
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-sm font-medium sm:col-span-2">
            Restante do pagamento (preencha só o que existir)
          </p>
          {texto("proprios_valor", "Recursos próprios (R$)", 20)}
          {texto("proprios_quando", "Quando", 200, "na assinatura da escritura")}
          {texto("fgts_valor", "FGTS (R$)", 20)}
          {temFin && (
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
          {(temFin || termo("fgts_valor").trim() !== "") &&
            texto("fin_prazo_dias", "Prazo para aprovar o crédito/FGTS (dias)", 3, "30")}
          {texto("permuta_valor", "Imóvel/bem dado em permuta (R$)", 20)}
          {texto("permuta_descricao", "Descrição do bem dado em permuta", 300)}
          {area(
            "parcelas",
            "Parcelas direto com o vendedor",
            "Ex.: 10 parcelas mensais de R$ 5.000,00, corrigidas pelo IPCA, vencendo todo dia 10, a partir de ...",
          )}
          {area(
            "pagamento_obs",
            "Outras condições de pagamento",
            "Ex.: o saldo será pago em até 5 dias úteis após a liberação do financiamento.",
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
          {texto(
            "posse",
            "Entrega das chaves (posse)",
            300,
            "na data da assinatura da escritura, com o imóvel livre e desocupado",
          )}
          {lista("comissao_quem", "Comissão de corretagem paga por", COMISSAO)}
          {texto("local", "Local (cidade/UF do documento)", 80, "da cidade da imobiliária")}
          {area(
            "itens",
            "Itens que permanecem no imóvel",
            "Ex.: armários planejados da cozinha e dos quartos, 2 aparelhos de ar-condicionado.",
          )}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="observacoes">Outras condições</Label>
            <Textarea
              id="observacoes"
              disabled={disabled}
              value={form.observacoes}
              maxLength={2000}
              placeholder="Ex.: a venda inclui a vaga de garagem nº 12; vistoria antes da entrega das chaves."
              onChange={(e) => set("observacoes", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
