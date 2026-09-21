import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CircleHelp, Loader2 } from "lucide-react";

export type Saver = () => Promise<boolean>;

const AUTOSAVE_DELAY_MS = 1200;

// Salva sozinho X ms depois da última alteração, sem precisar de clique em "Salvar".
// O delay evita gravar valor pela metade enquanto a pessoa ainda está digitando, e o
// savingRef evita disparar um novo save por cima de um que ainda não terminou.
export function useAutosave(
  dirty: boolean,
  deps: readonly unknown[],
  saveFn: () => Promise<boolean>,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      try {
        await saveFn();
      } finally {
        savingRef.current = false;
      }
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, ...deps]);
}

export function AutosaveStatus({ saving, dirty }: { saving: boolean; dirty: boolean }) {
  if (saving)
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Salvando...
      </div>
    );
  if (dirty)
    return (
      <div className="text-xs text-muted-foreground">
        Alterações pendentes — salvando em instantes...
      </div>
    );
  return null;
}

export function SaleSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>;
}

const FIELD_HINTS: Record<string, string> = {
  "ID do imóvel": "Informe o código ou identificador do imóvel no cadastro da imobiliária.",
  Matrícula: "Digite o número da matrícula do imóvel conforme o documento do cartório.",
  IPTU: "Informe o número do cadastro do IPTU, se disponível.",
  "Endereço do imóvel": "Preencha o endereço completo: rua, número, complemento, bairro e cidade.",
  "Código interno": "Use o código interno da negociação para facilitar a localização da venda.",
  "Tempo de venda (dias)": "Informe quantos dias se passaram desde a captação até o fechamento.",
  Mídia:
    "Selecione de onde veio o cliente ou a oportunidade: portal, indicação, rede social ou outro canal.",
  "Observações do imóvel":
    "Registre detalhes importantes do imóvel que não cabem nos outros campos.",
  "Corretor captador": "Selecione o corretor que captou o cliente ou iniciou o atendimento.",
  "Gestor/Team Leader do captador":
    "Selecione o gestor ou Team Leader responsável pelo lado da captação.",
  "Indicador do captador": "Selecione quem indicou o cliente para a captação, se houver.",
  "Corretor vendedor":
    "Selecione o corretor responsável pelo atendimento do vendedor/proprietário.",
  "Gestor/Team Leader do vendedor":
    "Selecione o gestor ou Team Leader responsável pelo lado do vendedor.",
  "Indicador do vendedor": "Selecione quem indicou o vendedor ou proprietário, se houver.",
  "% Comissão (referência)":
    "Percentual calculado a partir do valor negociado e da comissão total; não é preenchido manualmente.",
  "% da REMAX (sobre o valor negociado)":
    "Informe o percentual destinado à REMAX conforme a regra comercial aprovada.",
  "Valor da REMAX (R$)": "Informe ou confira o valor destinado à REMAX nesta venda.",
  "Líquido do captador (R$)":
    "Valor calculado que ficará para o lado do captador; não precisa ser preenchido.",
  "Líquido do vendedor (R$)":
    "Valor calculado que ficará para o lado do vendedor; não precisa ser preenchido.",
  "Valor para a imobiliária (R$)":
    "Valor calculado que ficará para a imobiliária; não precisa ser preenchido.",
  "Data de entrega da posse":
    "Selecione a data combinada para o comprador receber a posse do imóvel.",
  "Tipo de parceria":
    "Selecione se a parceria é com outra imobiliária ou com um corretor parceiro.",
  "Corretor(a) / Imobiliária parceira":
    "Informe o nome do corretor ou da imobiliária que participa da parceria.",
  "CPF/CNPJ":
    "Informe o CPF ou CNPJ do parceiro para identificar corretamente a parte da negociação.",
  "% Comissão": "Informe o percentual da comissão destinado ao parceiro, conforme combinado.",
  "Valor da comissão (R$)": "Informe o valor da comissão que será pago ao parceiro.",
  "Tem financiamento?": "Selecione Sim somente se parte do valor depender de financiamento.",
  "Valor financiado": "Informe o valor que será financiado pelo banco.",
  "Previsão de liberação": "Selecione a data estimada para o banco liberar o financiamento.",
  "Data de assinatura": "Selecione a data em que o contrato foi ou será assinado.",
  "Nota fiscal obrigatória":
    "Selecione Sim quando houver exigência de emissão de nota fiscal nesta operação.",
  "Valor da comissão (total)":
    "Informe o valor total da comissão da operação, conforme a negociação aprovada.",
  Valor: "Informe o valor correspondente à participação selecionada.",
  "% (sobre a origem)":
    "Informe o percentual calculado sobre o valor de origem desta participação.",
  Lado: "Selecione se a participação pertence ao lado do captador ou do vendedor.",
  Origem: "Selecione a origem da participação conforme a regra da comissão.",
  Papel: "Selecione o papel da pessoa na divisão da comissão.",
  Nome: "Informe o nome completo da pessoa. Para empresa, mantenha também a razão social abaixo.",
  "Razão social": "Digite a razão social exatamente como aparece no CNPJ.",
  CNPJ: "Informe o CNPJ da empresa. A pessoa que assinará pela empresa continua sendo cadastrada nos campos pessoais.",
  RG: "Digite o número do RG do comprador ou vendedor, sem incluir dados de outra pessoa.",
  CPF: "Informe o CPF da pessoa. Ao sair do campo, o sistema pode localizar um cadastro existente.",
  Profissão:
    "Informe a profissão atual da pessoa. Se não souber, confirme antes de deixar em branco.",
  "E-mail": "Use um e-mail válido da pessoa, de preferência aquele usado na negociação.",
  Telefone: "Informe um telefone atualizado com DDD para contato sobre a venda.",
  Endereço: "Digite o endereço completo da pessoa: rua, número, complemento, bairro e cidade.",
  "Regime de casamento":
    "Informe o regime de bens conforme a certidão. Exemplo: Comunhão parcial de bens.",
  Banco: "Digite o nome ou número do banco que receberá o pagamento.",
  Agência: "Informe o número da agência, incluindo o dígito se houver.",
  Conta: "Informe o número da conta bancária e o dígito, se houver.",
  PIX: "Digite a chave PIX que receberá o pagamento. Confira antes de salvar.",
  "Entrada — valor":
    "Informe quanto será pago como entrada. Se não houver entrada, informe R$ 0,00.",
  "Entrada — quando": "Informe quando a entrada será paga. Exemplo: Na assinatura do contrato.",
  "Parcela 1 — valor": "Informe o valor da primeira parcela. Se não houver, mantenha R$ 0,00.",
  "Parcela 1 — quando":
    "Informe a data ou condição da primeira parcela. Exemplo: 30 dias após a assinatura.",
  "Parcela 2 — valor": "Informe o valor da segunda parcela. Se não houver, mantenha R$ 0,00.",
  "Parcela 2 — quando":
    "Informe a data ou condição da segunda parcela. Exemplo: Na entrega das chaves.",
  "Pagamento final — valor": "Informe o saldo que ficará para a última etapa do pagamento.",
  "Pagamento final — quando":
    "Informe quando o saldo final será pago. Exemplo: Na liberação do financiamento.",
  FGTS: "Selecione Sim somente se o comprador utilizar FGTS nesta compra.",
  "FGTS — valor": "Informe o valor aproximado do FGTS. Se não for usar, mantenha R$ 0,00.",
  "Tipo de pagamento": "Selecione a forma principal: à vista, financiamento ou consórcio.",
  "Financiamento — valor": "Informe o valor que será financiado pelo banco.",
  "Banco financiador": "Digite o nome do banco que analisará ou liberará o financiamento.",
  "Correspondente bancário":
    "Informe o nome do correspondente que acompanha o financiamento, se houver.",
  "Oba Crédito": "Selecione Sim somente se esta negociação usar a operação do Oba Crédito.",
  "Previsão da liberação do crédito": "Selecione a data estimada para o banco liberar o crédito.",
  "Valor da carta de consórcio": "Informe o valor da carta de crédito do consórcio.",
  "Nome do consórcio": "Digite o nome da administradora ou do consórcio.",
  Grupo: "Informe o número ou identificação do grupo do consórcio.",
  Cota: "Informe o número da cota do consórcio.",
  "Observações gerais":
    "Registre condições importantes do pagamento que não foram informadas nos campos anteriores.",
  "Valor anunciado (R$)": "Informe o valor inicialmente anunciado para o imóvel.",
  "Valor negociado (R$)": "Informe o valor final combinado entre comprador e vendedor.",
  "Valor total da comissão (R$)":
    "Informe o valor total da comissão desta venda, conforme a negociação aprovada.",
  "Forma de pagamento":
    "Informe em qual evento o proprietário pagará a comissão. Exemplos: na assinatura do contrato, no recebimento da entrada, na liberação do financiamento ou na entrega das chaves. Se for parcelado, descreva cada evento e informe os valores nas parcelas abaixo.",
  Observações:
    "Registre uma condição relevante da negociação que ainda não apareceu nos outros campos.",
};

const getFieldHint = (label: string) => {
  if (FIELD_HINTS[label]) return FIELD_HINTS[label];
  if (label.startsWith("Comissão "))
    return "Informe o valor da comissão deste participante conforme a divisão aprovada pelo gestor.";
  if (label.startsWith("1ª parcela —"))
    return "Preencha a previsão de recebimento da primeira parcela da comissão.";
  if (label.startsWith("2ª parcela —"))
    return "Preencha a previsão de recebimento da segunda parcela da comissão.";
  if (label.startsWith("3ª parcela —"))
    return "Preencha a previsão de recebimento da terceira parcela da comissão.";
  return undefined;
};

export function Field({
  label,
  children,
  colSpan,
  hint,
  invalid = false,
  errorText,
}: {
  label: string;
  children: React.ReactNode;
  colSpan?: number;
  hint?: string;
  invalid?: boolean;
  errorText?: string;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const guidance = hint ?? getFieldHint(label);

  return (
    <div className={colSpan === 2 ? "md:col-span-2" : ""}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Label
          className={`block text-xs ${invalid ? "text-destructive" : "text-muted-foreground"}`}
        >
          {label}
        </Label>
        {guidance && (
          <button
            type="button"
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${helpOpen ? "border-primary bg-primary text-primary-foreground" : "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"}`}
            aria-label={`Orientação sobre ${label}`}
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((open) => !open)}
          >
            <CircleHelp className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div
        className={
          invalid
            ? "[&_input]:border-destructive [&_input]:ring-1 [&_input]:ring-destructive/30"
            : undefined
        }
      >
        {children}
      </div>
      {invalid && errorText && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {errorText}
        </p>
      )}
      {guidance && helpOpen && (
        <div
          role="note"
          className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-foreground"
        >
          <span className="font-semibold text-primary">O que preencher: </span>
          {guidance}
        </div>
      )}
    </div>
  );
}

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Campo de valor em reais: digita-se em centavos (estilo maquininha) e formata como "R$ 1.234,56". */
export function CurrencyInput({
  value,
  onChange,
  disabled,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  const [display, setDisplay] = useState(() => (value != null ? brl(Math.round(value * 100)) : ""));

  useEffect(() => {
    setDisplay(value != null ? brl(Math.round(value * 100)) : "");
  }, [value]);

  return (
    <Input
      inputMode="decimal"
      placeholder="R$ 0,00"
      disabled={disabled}
      value={display}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        if (!digits) {
          setDisplay("");
          onChange(null);
          return;
        }
        const cents = parseInt(digits, 10);
        setDisplay(brl(cents));
        onChange(cents / 100);
      }}
    />
  );
}

export const money = (v: unknown) =>
  v != null ? `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : null;
// Colunas `date` do banco chegam como "YYYY-MM-DD" sem hora — `new Date(...)` direto interpreta isso
// como meia-noite UTC, e em fusos atrás de UTC (Brasil) o toLocaleDateString mostra o dia anterior.
// Datas com hora (timestamptz) continuam indo pro Date normal, que já lida certo com fuso.
export const dateBR = (v: unknown) => {
  if (!v) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("pt-BR");
  }
  if (!(typeof v === "string" || typeof v === "number" || v instanceof Date)) return null;
  return new Date(v).toLocaleDateString("pt-BR");
};

export function DocStatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    pendente: "bg-muted text-muted-foreground",
    enviado: "bg-blue-100 text-blue-900",
    aprovado: "bg-emerald-100 text-emerald-900",
    recusado: "bg-destructive/15 text-destructive",
  };
  const label: Record<string, string> = {
    pendente: "Pendente",
    enviado: "Enviado",
    aprovado: "Aprovado",
    recusado: "Recusado",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone[status]}`}>
      {label[status]}
    </span>
  );
}
