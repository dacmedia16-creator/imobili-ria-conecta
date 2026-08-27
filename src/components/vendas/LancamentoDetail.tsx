import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Send,
  Loader2,
  XCircle,
  CheckCircle2,
  RotateCcw,
  AlertTriangle,
  Printer,
  Pencil,
} from "lucide-react";
import {
  MIDIA_OPTIONS,
  LANCAMENTO_COMISSAO_PAPEIS,
  STATUS_LABEL,
  type SaleStatus,
} from "@/lib/status";
import { notifySaleStatusChange } from "@/lib/sale-notifications.functions";
import {
  useAutosave,
  AutosaveStatus,
  SaleSection,
  FieldGrid,
  Field,
  CurrencyInput,
  money,
} from "@/components/vendas/shared";
import { OccurrenceReportBody } from "@/components/vendas/OccurrenceReportBody";
import { PaymentStep } from "@/components/vendas/PaymentStep";
import {
  mesclarPessoasAtivas,
  resolverSelecaoBeneficiario,
  SEM_CADASTRO_VALUE,
  precisaEscolherBeneficiario,
  valorSelectBeneficiario,
} from "@/lib/lancamento-pessoas";
import { calcularDistribuicaoLancamento } from "@/lib/lancamento-distribuicao";
import { sanitizeLancamentoResumoPayload } from "@/lib/lancamento-resumo";

/** Diff raso entre dois objetos "planos" (Resumo/Construtora) — só as chaves presentes em `depois`,
 * comparando null/"" como equivalentes a undefined pra não logar troca de tipo sem troca de valor
 * real. Usado só pro registro de auditoria (activity_logs), nunca pra decidir o que salvar. */
function diffCampos(
  antes: Record<string, any>,
  depois: Record<string, any>,
): Record<string, { de: any; para: any }> {
  const changes: Record<string, { de: any; para: any }> = {};
  for (const key of Object.keys(depois)) {
    const a = antes[key] ?? null;
    const b = depois[key] ?? null;
    if (a !== b) changes[key] = { de: a, para: b };
  }
  return changes;
}

/** Traduz activity_logs.acao + payload num texto de uma linha pro painel "Atividade" do Lançamento.
 * Cópia deliberadamente separada de describeAtividade() em vendas.$id.tsx (Venda Normal) — mesma
 * ideia, ações diferentes; não reaproveita porque as duas telas têm ações que não existem uma na
 * outra, e misturar os dois switches deixaria os dois fluxos acoplados sem necessidade. */
function describeAtividadeLancamento(
  acao: string,
  payload: any,
): { label: string; detail?: string } {
  const p = payload ?? {};
  switch (acao) {
    case "lancamento_criado":
      return {
        label: "Criou o lançamento",
        detail: [p.imovel_id, p.construtora].filter(Boolean).join(" — ") || undefined,
      };
    case "lancamento_editado": {
      const campos = Object.keys(p.alteracoes ?? {});
      return {
        label: "Editou o Resumo/Construtora/Compradores",
        detail: campos.length ? campos.join(", ") : undefined,
      };
    }
    case "lancamento_comissao_editada": {
      const antes = p.antes ?? [];
      const depois = p.depois ?? [];
      return {
        label: "Editou a divisão da comissão",
        detail: `${antes.length} linha(s) → ${depois.length} linha(s)`,
      };
    }
    case "status_change":
      return {
        label: "Mudou o status",
        detail: p.de && p.para ? `${p.de} → ${p.para}` : undefined,
      };
    case "occurrence_created":
      return { label: "Criou a ocorrência" };
    case "lancamento_concluido":
      return {
        label: "Concluiu a ocorrência",
        detail: `Saldo da imobiliária/construtora: ${money(p.saldo_imobiliaria) ?? "—"}`,
      };
    default:
      return { label: acao };
  }
}

/** Tela única (sem wizard) da venda de Lançamento: sem documentos, sem jurídico, sem contrato — só
 * o formulário que o corretor/coordenador preenche, e que já sai direto pro financeiro ao enviar
 * (ver criar_ocorrencia_lancamento). Documentos/Partes/Pagamento do fluxo normal não se aplicam aqui
 * (são feitos pra pessoa física com CPF/RG/indicador — overkill e confuso pra uma venda de lançamento). */
export function LancamentoDetail({
  saleId,
  sale,
  parties,
  payment,
  commissionExtras,
  onChange,
}: {
  saleId: string;
  sale: any;
  parties: Record<string, any>;
  payment: any;
  commissionExtras: any[];
  onChange: () => void | Promise<void>;
}) {
  const { user, hasAny } = useAuth();
  const router = useRouter();
  const isOwner = sale.corretor_id === user?.id;
  const isFinanceiro = hasAny(["financeiro", "admin", "super_admin"]);
  const canEdit = (sale.status === "rascunho" || sale.status === "devolvida_ajuste") && isOwner;
  const isResend = sale.status === "devolvida_ajuste";
  const [paymentDirty, setPaymentDirty] = useState(false);

  // Edição da ocorrência já criada pelo financeiro, enquanto está em análise OU já devolvida pro
  // corretor ajustar (financeiro não precisa esperar o corretor reenviar se puder corrigir direto —
  // pedido explícito do usuário em 19/08, ampliando o escopo original da migration 20260819060000,
  // que por engano só cobria 'ocorrencia_analise_financeiro'). Chama a RPC
  // editar_ocorrencia_lancamento_financeiro (migration 20260819080000), que atualiza sales +
  // sale_commission_extras e resincroniza occurrences/occurrence_commissions numa única transação —
  // nunca escreve direto nessas duas últimas tabelas (calcular_distribuicao_venda, que decide
  // "Comissão bruta"/"Saldo da imobiliária" e o gate do Concluir, sempre lê de sales/
  // sale_commission_extras pra Lançamento, nunca de occurrence_commissions).
  const canEditFinanceiro =
    isFinanceiro &&
    (sale.status === "ocorrencia_analise_financeiro" || sale.status === "devolvida_ajuste");
  const [editOcc, setEditOcc] = useState(false);
  const [editResumo, setEditResumo] = useState<any>({});
  const [editFinanciamento, setEditFinanciamento] = useState<any>({});
  const [editLinhas, setEditLinhas] = useState<any[]>([]);
  const [editMotivoOpen, setEditMotivoOpen] = useState(false);
  const [editMotivo, setEditMotivo] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const abrirEdicaoFinanceiro = () => {
    setEditResumo({
      imovel_id: sale.imovel_id ?? "",
      data_assinatura: sale.data_assinatura ?? null,
      tempo_venda_dias: sale.tempo_venda_dias ?? null,
      nota_fiscal_obrigatoria: !!sale.nota_fiscal_obrigatoria,
      midia: sale.midia ?? null,
      valor_anunciado: sale.valor_anunciado ?? null,
      valor_negociado: sale.valor_negociado ?? null,
      percentual_comissao: sale.percentual_comissao ?? null,
      valor_total_comissao: sale.valor_total_comissao ?? null,
      premio_valor: sale.premio_valor ?? null,
      previsao_recebimento_valor: sale.previsao_recebimento_valor ?? null,
      previsao_recebimento_data: sale.previsao_recebimento_data ?? null,
      previsao_recebimento_forma: sale.previsao_recebimento_forma ?? "",
      previsao_recebimento2_valor: sale.previsao_recebimento2_valor ?? null,
      previsao_recebimento2_data: sale.previsao_recebimento2_data ?? null,
      previsao_recebimento2_forma: sale.previsao_recebimento2_forma ?? "",
      previsao_recebimento3_valor: sale.previsao_recebimento3_valor ?? null,
      previsao_recebimento3_data: sale.previsao_recebimento3_data ?? null,
      previsao_recebimento3_forma: sale.previsao_recebimento3_forma ?? "",
      negociacao_observacoes: sale.negociacao_observacoes ?? "",
    });
    setEditFinanciamento({
      financiamento: !!occ?.financiamento,
      financiamento_valor: occ?.financiamento_valor ?? null,
      financiamento_banco: occ?.financiamento_banco ?? "",
      financiamento_correspondente: occ?.financiamento_correspondente ?? "",
      financiamento_previsao: occ?.financiamento_previsao ?? null,
      oba_credito: !!occ?.oba_credito,
    });
    setEditLinhas(commissionExtras.map((c) => ({ ...c })));
    setEditOcc(true);
  };
  const updEditResumo = (patch: any) => setEditResumo((f: any) => ({ ...f, ...patch }));
  const updEditFinanciamento = (patch: any) =>
    setEditFinanciamento((f: any) => ({ ...f, ...patch }));
  const updEditLinha = (id: string, patch: any) =>
    setEditLinhas((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addEditLinha = () =>
    setEditLinhas((rows) => [
      ...rows,
      {
        id: `new-${crypto.randomUUID()}`,
        papel: "corretor_vendedor",
        nome: "",
        user_id: null,
        percentual: null,
        valor: null,
        sem_cadastro_confirmado: false,
        _new: true,
      },
    ]);
  const delEditLinha = (id: string) => setEditLinhas((rows) => rows.filter((r) => r.id !== id));

  const editPreviewDist = useMemo(
    () =>
      calcularDistribuicaoLancamento({
        valorNegociado: editResumo.valor_negociado,
        percentualComissao: editResumo.percentual_comissao,
        valorTotalComissao: editResumo.valor_total_comissao,
        premioValor: editResumo.premio_valor,
        linhas: editLinhas.map((c) => ({
          valor: c.valor,
          percentual: c.percentual,
          semCadastroConfirmado: !!c.sem_cadastro_confirmado,
        })),
      }),
    [
      editResumo.valor_negociado,
      editResumo.percentual_comissao,
      editResumo.valor_total_comissao,
      editResumo.premio_valor,
      editLinhas,
    ],
  );

  const confirmarSalvarEdicaoFinanceiro = async () => {
    if (!editMotivo.trim()) {
      toast.error("Motivo é obrigatório.");
      return;
    }
    const semEscolha = editLinhas.find(precisaEscolherBeneficiario);
    if (semEscolha) {
      toast.error(
        'Escolha um beneficiário cadastrado ou marque explicitamente "Sem cadastro / parceiro externo" em cada linha da divisão da comissão antes de salvar.',
      );
      return;
    }
    if (!editPreviewDist.calculo_valido) {
      toast.error(editPreviewDist.inconsistencias[0]);
      return;
    }
    setSalvandoEdicao(true);
    try {
      const { data, error } = await supabase.rpc("editar_ocorrencia_lancamento_financeiro", {
        p_sale_id: saleId,
        p_sale_patch: sanitizeLancamentoResumoPayload(editResumo),
        p_occ_patch: {
          financiamento: !!editFinanciamento.financiamento,
          financiamento_valor: editFinanciamento.financiamento_valor,
          financiamento_banco: editFinanciamento.financiamento_banco || null,
          financiamento_correspondente: editFinanciamento.financiamento_correspondente || null,
          financiamento_previsao: editFinanciamento.financiamento_previsao || null,
          oba_credito: !!editFinanciamento.oba_credito,
        },
        p_linhas: editLinhas.map((r) => ({
          id: r._new ? null : r.id,
          papel: r.papel,
          nome: r.nome || null,
          user_id: r.user_id || null,
          percentual: r.percentual,
          valor: r.valor,
          sem_cadastro_confirmado: !!r.sem_cadastro_confirmado,
        })),
        p_motivo: editMotivo.trim(),
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setDistribuicao(data ?? null);
      toast.success("Ocorrência atualizada.");
      setEditMotivoOpen(false);
      setEditMotivo("");
      setEditOcc(false);
      // Fechar o Dialog de motivo e sair do modo de edição no mesmo tick (setEditOcc(false) logo
      // depois) às vezes deixa o Radix sem rodar a própria limpeza de "pointer-events: none" que ele
      // aplica no <body> pra travar a página atrás do dialog aberto — a página inteira fica
      // clicável-zero até um F5. Reforça a limpeza aqui mesmo, depois do próximo paint, sem depender
      // só do Radix pra isso.
      requestAnimationFrame(() => {
        document.body.style.pointerEvents = "";
      });
      const { data: o } = await supabase
        .from("occurrences")
        .select("*")
        .eq("sale_id", saleId)
        .maybeSingle();
      setOcc(o);
      if (o) {
        const { data: c } = await supabase
          .from("occurrence_commissions")
          .select("*")
          .eq("occurrence_id", o.id)
          .order("created_at");
        setOccCommissions(c ?? []);
      }
      await onChange();
      await loadHistorico();
    } finally {
      setSalvandoEdicao(false);
    }
  };

  // Motivo da devolução mais recente — mostrado direto no banner (o painel de Histórico abaixo
  // também mostra essa mesma linha, mas com menos destaque).
  const [motivoDevolucao, setMotivoDevolucao] = useState<string | null>(null);
  useEffect(() => {
    if (sale.status !== "devolvida_ajuste") {
      setMotivoDevolucao(null);
      return;
    }
    supabase
      .from("sale_status_history")
      .select("motivo")
      .eq("sale_id", saleId)
      .eq("para", "devolvida_ajuste")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setMotivoDevolucao(data?.motivo ?? null));
  }, [sale.status, saleId]);

  // ----- Histórico: sale_status_history + activity_logs, os mesmos dois já usados pela Venda
  // Normal — nenhuma tabela nova, nenhum evento retroativo inventado (só o que já foi gravado). -----
  const [history, setHistory] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [activityAuthorNames, setActivityAuthorNames] = useState<Record<string, string>>({});
  const loadHistorico = useCallback(async () => {
    const [{ data: h }, { data: a }] = await Promise.all([
      supabase
        .from("sale_status_history")
        .select("*")
        .eq("sale_id", saleId)
        .order("created_at", { ascending: false }),
      supabase
        .from("activity_logs")
        .select("*")
        .eq("sale_id", saleId)
        .order("created_at", { ascending: false }),
    ]);
    setHistory(h ?? []);
    setActivity(a ?? []);
  }, [saleId]);
  useEffect(() => {
    loadHistorico();
  }, [loadHistorico]);
  useEffect(() => {
    const ids = Array.from(
      new Set(
        activity
          .map((a) => a.autor_id)
          .filter((id): id is string => !!id && !activityAuthorNames[id]),
      ),
    );
    if (ids.length === 0) return;
    (async () => {
      const { data: profs } = await supabase.from("profiles").select("id, nome").in("id", ids);
      const next: Record<string, string> = {};
      for (const p of profs ?? []) next[p.id] = p.nome ?? p.id;
      setActivityAuthorNames((m) => ({ ...m, ...next }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity]);

  // Ocorrência já criada (qualquer status além de rascunho) — busca pra exibir a mesma tela formatada
  // "Ocorrência de compra e venda" que as vendas normais têm, em vez de repetir os campos do
  // formulário desabilitados. Também busca em devolvida_ajuste (a ocorrência já existe desde o
  // primeiro envio — só o status muda) pra dar pro financeiro/admin ver o relatório e o botão Editar
  // enquanto o dono ainda não reenviou (canEditFinanceiro acima).
  const [occ, setOcc] = useState<any>(null);
  const [occCommissions, setOccCommissions] = useState<any[]>([]);
  const [loadingOcc, setLoadingOcc] = useState(false);
  useEffect(() => {
    if (sale.status === "rascunho") {
      setOcc(null);
      return;
    }
    setLoadingOcc(true);
    (async () => {
      const { data: o } = await supabase
        .from("occurrences")
        .select("*")
        .eq("sale_id", saleId)
        .maybeSingle();
      setOcc(o);
      if (o) {
        const { data: c } = await supabase
          .from("occurrence_commissions")
          .select("*")
          .eq("occurrence_id", o.id)
          .order("created_at");
        setOccCommissions(c ?? []);
      }
      setLoadingOcc(false);
    })();
  }, [sale.status, saleId]);

  // ----- Divisão financeira: mesma RPC calcular_distribuicao_venda() da Venda Normal (fonte única —
  // ver migration 20260818000000), que reconhece modalidade = 'lancamento' e devolve
  // comissao_bruta/total_pessoas/parceria_externa/saldo_imobiliaria/calculo_valido. Refeita a cada
  // salvamento (Resumo ou comissão) pra refletir o que está persistido. -----
  const [distribuicao, setDistribuicao] = useState<any>(null);
  const refreshDistribuicao = useCallback(async () => {
    const { data } = await supabase.rpc("calcular_distribuicao_venda", { p_sale_id: saleId });
    setDistribuicao(data ?? null);
  }, [saleId]);
  useEffect(() => {
    refreshDistribuicao();
  }, [refreshDistribuicao]);

  // ----- Ações do financeiro sobre a Ocorrência já criada: devolver pro dono corrigir, concluir,
  // reabrir depois de concluída — mesmas ações que as vendas normais têm, adaptadas ao fluxo de
  // Lançamento (sem gestor no meio, então "devolver" volta direto pro corretor/coordenador). -----
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnMotivo, setReturnMotivo] = useState("");
  const [returning, setReturning] = useState(false);
  const submitReturn = async () => {
    if (!returnMotivo.trim()) {
      toast.error("Motivo é obrigatório");
      return;
    }
    setReturning(true);
    try {
      const { error } = await supabase.rpc("change_sale_status", {
        _sale_id: saleId,
        _new_status: "devolvida_ajuste",
        _motivo: returnMotivo,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      notifySaleStatusChange({
        data: { saleId, status: "devolvida_ajuste", motivo: returnMotivo },
      }).catch(() => {});
      toast.success("Lançamento devolvido");
      setReturnOpen(false);
      await onChange();
    } finally {
      setReturning(false);
    }
  };

  // Concluir exige confirmar explicitamente o saldo da imobiliária/construtora calculado no momento
  // (regra 6 do pedido) — abre um diálogo mostrando o valor recalculado na hora (não o que estava em
  // tela antes, pra não confirmar um número desatualizado) e só then chama concluir_lancamento(),
  // que grava esse valor nas colunas lancamento_saldo_* e é a mesma checagem que a trigger do banco
  // (trg_validar_distribuicao_concluir_lancamento) reforça de qualquer forma.
  const [concludeOpen, setConcludeOpen] = useState(false);
  const [concludeDist, setConcludeDist] = useState<any>(null);
  const [concludeLoading, setConcludeLoading] = useState(false);
  const [concluding, setConcluding] = useState(false);
  const openConcluir = async () => {
    setConcludeOpen(true);
    setConcludeLoading(true);
    const { data } = await supabase.rpc("calcular_distribuicao_venda", { p_sale_id: saleId });
    setConcludeDist(data ?? null);
    setDistribuicao(data ?? null);
    setConcludeLoading(false);
  };
  const confirmarConcluir = async () => {
    if (!concludeDist) return;
    setConcluding(true);
    try {
      const { data, error } = await supabase.rpc("concluir_lancamento", {
        p_sale_id: saleId,
        p_saldo_confirmado: concludeDist.saldo_imobiliaria,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setDistribuicao(data ?? null);
      toast.success("Ocorrência concluída");
      setConcludeOpen(false);
      await onChange();
      await loadHistorico();
    } finally {
      setConcluding(false);
    }
  };

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenMotivo, setReopenMotivo] = useState("");
  const [reopening, setReopening] = useState(false);
  const submitReopen = async () => {
    if (!reopenMotivo.trim()) {
      toast.error("Motivo é obrigatório");
      return;
    }
    setReopening(true);
    try {
      const { error } = await supabase.rpc("change_sale_status", {
        _sale_id: saleId,
        _new_status: "ocorrencia_analise_financeiro",
        _motivo: `Reaberta: ${reopenMotivo}`,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Ocorrência reaberta");
      setReopenOpen(false);
      setReopenMotivo("");
      await onChange();
      await loadHistorico();
    } finally {
      setReopening(false);
    }
  };

  // ----- Resumo: campos direto em sales -----
  // BUG #1 (pré-existente, achado na validação mobile da Etapa 3, corrigido em
  // fix/lancamento-bloqueadores-preexistentes): data_assinatura/previsao_recebimento_data (colunas
  // `date`) e midia (CHECK constraint com lista fixa) nunca podem ser "" no banco -- só null ou um
  // valor válido. Antes, o default aqui era "" quando o valor vindo do banco era null, e como
  // saveForm() manda o form INTEIRO em todo autosave (não só o campo editado), editar QUALQUER
  // outro campo do Resumo num Lançamento novo (ex.: só "Valor negociado") já disparava "invalid
  // input syntax for type date" ou "violates check constraint sales_midia_check" -- travando o
  // autosave até a pessoa descobrir sozinha que precisa preencher datas/mídia primeiro.
  const initialForm = {
    imovel_id: sale.imovel_id ?? "",
    data_assinatura: sale.data_assinatura ?? null,
    nota_fiscal_obrigatoria: !!sale.nota_fiscal_obrigatoria,
    midia: sale.midia ?? null,
    valor_anunciado: sale.valor_anunciado ?? null,
    valor_negociado: sale.valor_negociado ?? null,
    percentual_comissao: sale.percentual_comissao ?? null,
    valor_total_comissao: sale.valor_total_comissao ?? null,
    premio_valor: sale.premio_valor ?? null,
    previsao_recebimento_valor: sale.previsao_recebimento_valor ?? null,
    previsao_recebimento_data: sale.previsao_recebimento_data ?? null,
    previsao_recebimento_forma: sale.previsao_recebimento_forma ?? "",
    previsao_recebimento2_valor: sale.previsao_recebimento2_valor ?? null,
    previsao_recebimento2_data: sale.previsao_recebimento2_data ?? null,
    previsao_recebimento2_forma: sale.previsao_recebimento2_forma ?? "",
    previsao_recebimento3_valor: sale.previsao_recebimento3_valor ?? null,
    previsao_recebimento3_data: sale.previsao_recebimento3_data ?? null,
    previsao_recebimento3_forma: sale.previsao_recebimento3_forma ?? "",
    negociacao_observacoes: sale.negociacao_observacoes ?? "",
  };
  const [form, setForm] = useState(() => initialForm);
  // "Antes" pro diff de auditoria (regra 8: editar precisa registrar antes/depois) — atualizado só
  // depois de um save bem-sucedido, nunca a cada tecla (senão nunca haveria diferença pra logar).
  const formBeforeRef = useRef(initialForm);
  const [dirty, setDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const upd = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const saveForm = useCallback(async () => {
    // Normaliza de novo aqui (defesa em profundidade) -- mesmo que algum campo volte a virar "" por
    // outro caminho no futuro, nunca deixa uma string vazia chegar nas colunas date/CHECK-constrained.
    const payload = sanitizeLancamentoResumoPayload(form);
    const { error } = await supabase.from("sales").update(payload).eq("id", saleId);
    if (error) {
      // Erro persistente e visível (não só um toast que some sozinho) -- sem isso, o autosave falha
      // em silêncio a cada edição seguinte e a pessoa não entende por que "Enviar ao financeiro"
      // nunca destrava, já que dirty nunca zera enquanto o erro não for corrigido.
      setFormError(error.message);
      toast.error(error.message);
      return false;
    }
    setFormError(null);
    const alteracoes = diffCampos(formBeforeRef.current, form);
    if (Object.keys(alteracoes).length > 0 && user) {
      supabase
        .from("activity_logs")
        .insert({
          sale_id: saleId,
          autor_id: user.id,
          acao: "lancamento_editado",
          payload: { alteracoes },
        })
        .then(() => {
          loadHistorico();
        });
    }
    formBeforeRef.current = form;
    setDirty(false);
    await refreshDistribuicao();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, saleId, user]);
  useAutosave(canEdit && dirty, [form], saveForm);

  // ----- Construtora (vendedor_1) + compradores: sale_parties -----
  // Números de comprador além do 1º (que sempre existe, criado junto com a venda) — mesmo padrão de
  // "extras sob demanda" usado em DocumentsPanel pra comprador_N/vendedor_N.
  const [compradorNums, setCompradorNums] = useState<number[]>(() => {
    const nums = Object.keys(parties)
      .map((p) => p.match(/^comprador_(\d+)$/)?.[1])
      .filter(Boolean)
      .map(Number)
      .filter((n) => n > 1);
    return Array.from(new Set(nums)).sort((a, b) => a - b);
  });
  const partiesPapeis = [
    "vendedor_1",
    "comprador_1",
    ...compradorNums.map((n) => `comprador_${n}`),
  ];
  const initialPartiesForm = (() => {
    const init: Record<string, any> = {};
    for (const papel of partiesPapeis) {
      const p = parties[papel] ?? {};
      init[papel] =
        papel === "vendedor_1"
          ? {
              razao_social: p.razao_social ?? "",
              cnpj: p.cnpj ?? "",
              email: p.email ?? "",
              telefone: p.telefone ?? "",
            }
          : {
              nome: p.nome ?? "",
              cpf_cnpj: p.cpf_cnpj ?? "",
              rg: p.rg ?? "",
              email: p.email ?? "",
              telefone: p.telefone ?? "",
            };
    }
    return init;
  })();
  const [partiesForm, setPartiesForm] = useState<Record<string, any>>(() => initialPartiesForm);
  const partiesBeforeRef = useRef(initialPartiesForm);
  const [partiesDirty, setPartiesDirty] = useState(false);
  const updParty = (papel: string, patch: any) => {
    setPartiesForm((f) => ({ ...f, [papel]: { ...f[papel], ...patch } }));
    setPartiesDirty(true);
  };
  const addComprador = () => {
    const next = compradorNums.length ? Math.max(...compradorNums) + 1 : 2;
    setCompradorNums((nums) => [...nums, next]);
    setPartiesForm((f) => ({
      ...f,
      [`comprador_${next}`]: { nome: "", cpf_cnpj: "", rg: "", email: "", telefone: "" },
    }));
    setPartiesDirty(true);
  };
  const savePartiesForm = useCallback(async () => {
    for (const papel of partiesPapeis) {
      const data = partiesForm[papel];
      if (!data) continue;
      const existing = parties[papel];
      const { error } = existing?.id
        ? await supabase.from("sale_parties").update(data).eq("id", existing.id)
        : await supabase.from("sale_parties").insert({
            sale_id: saleId,
            papel,
            tipo_pessoa: papel === "vendedor_1" ? "juridica" : "fisica",
            ...data,
          });
      if (error) {
        toast.error(error.message);
        return false;
      }
    }
    const alteracoes: Record<string, any> = {};
    for (const papel of partiesPapeis) {
      const d = diffCampos(partiesBeforeRef.current[papel] ?? {}, partiesForm[papel] ?? {});
      if (Object.keys(d).length > 0) alteracoes[papel] = d;
    }
    if (Object.keys(alteracoes).length > 0 && user) {
      supabase
        .from("activity_logs")
        .insert({
          sale_id: saleId,
          autor_id: user.id,
          acao: "lancamento_editado",
          payload: { alteracoes },
        })
        .then(() => {
          loadHistorico();
        });
    }
    partiesBeforeRef.current = partiesForm;
    setPartiesDirty(false);
    await onChange();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partiesForm, partiesPapeis, parties, saleId, onChange, user]);
  useAutosave(canEdit && partiesDirty, [partiesForm], savePartiesForm);

  // ----- Divisão da comissão: sale_commission_extras, via RPC transacional (ver migration
  // 20260818010000) em vez de N chamadas separadas — evita falso-positivo de bloqueio num estado
  // intermediário (linha removida numa chamada, linha somada na próxima) e é onde o banco realmente
  // barra excesso > R$0,01 (regra 4 do pedido), com o antes/depois já logado pela própria RPC. -----
  const [pessoasAtivas, setPessoasAtivas] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => {
    (async () => {
      const [{ data: corretores }, { data: gestores }, { data: teamLeaders }] = await Promise.all([
        supabase.rpc("list_active_corretores"),
        supabase.rpc("list_active_gestores"),
        supabase.rpc("list_active_team_leaders"),
      ]);
      const norm = (rows: { id: string; nome: string | null }[] | null) =>
        (rows ?? []).map((p) => ({ id: p.id, nome: p.nome ?? p.id }));
      setPessoasAtivas(mesclarPessoasAtivas(norm(corretores), norm(gestores), norm(teamLeaders)));
    })();
  }, []);

  const [commRows, setCommRows] = useState<any[]>(() => commissionExtras.map((c) => ({ ...c })));
  const [commDirty, setCommDirty] = useState(false);
  const [commError, setCommError] = useState<string | null>(null);
  const updComm = (id: string, patch: any) => {
    setCommRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setCommDirty(true);
  };
  const addComm = () => {
    // BUG #2 (pré-existente, achado na validação mobile da Etapa 3, corrigido em
    // fix/lancamento-bloqueadores-preexistentes): sem_cadastro_confirmado começa false de propósito
    // -- é o que faz o Select de "Nome" abaixo mostrar o placeholder "Selecione um beneficiário" em
    // vez de já aparecer como "Sem cadastro" escolhido sem a pessoa ter clicado em nada. Antes, a
    // linha nascia parecendo confirmada como parceria externa; agora exige uma escolha explícita
    // (pessoa real OU "Sem cadastro") antes de salvar -- ver validação em saveComm(). O preview de
    // previewDistribuicao (calcularDistribuicaoLancamento) não pega esse caso sozinho: ele só recebe
    // {valor, semCadastroConfirmado} por linha, então uma linha com valor preenchido mas ainda sem
    // escolha nenhuma passa como "válida" no cálculo -- daí a checagem adicional abaixo.
    setCommRows((rows) => [
      ...rows,
      {
        id: `new-${crypto.randomUUID()}`,
        papel: "corretor_vendedor",
        nome: "",
        user_id: null,
        percentual: null,
        valor: null,
        sem_cadastro_confirmado: false,
        _new: true,
      },
    ]);
    setCommDirty(true);
  };
  const delComm = (id: string) => {
    setCommRows((rows) => rows.filter((r) => r.id !== id));
    setCommDirty(true);
  };

  // Preview instantâneo (sem round-trip) da mesma conta que o banco faz — usado só pra bloquear o
  // autosave localmente e mostrar o banner em tempo real enquanto a pessoa digita. Quem persiste e
  // quem bloqueia de verdade continua sendo a RPC + a trigger do banco (ver
  // src/lib/lancamento-distribuicao.ts).
  const previewDistribuicao = useMemo(
    () =>
      calcularDistribuicaoLancamento({
        valorNegociado: form.valor_negociado,
        percentualComissao: form.percentual_comissao,
        valorTotalComissao: form.valor_total_comissao,
        premioValor: form.premio_valor,
        linhas: commRows.map((c) => ({
          valor: c.valor,
          percentual: c.percentual,
          semCadastroConfirmado: !!c.sem_cadastro_confirmado,
        })),
      }),
    [
      form.valor_negociado,
      form.percentual_comissao,
      form.valor_total_comissao,
      form.premio_valor,
      commRows,
    ],
  );

  const saveComm = useCallback(async () => {
    // Mesma regra que o banco já reforça via CHECK (sale_commission_extras_exige_vinculo_ou_
    // confirmacao), mas checada aqui ANTES de gastar uma ida ao banco, com mensagem humana em vez do
    // erro cru do Postgres -- e sem marcar commDirty=false, então "Enviar ao financeiro" continua
    // corretamente bloqueado até a pessoa resolver.
    const semEscolha = commRows.find(precisaEscolherBeneficiario);
    if (semEscolha) {
      const msg =
        'Escolha um beneficiário cadastrado ou marque explicitamente "Sem cadastro / parceiro externo" em cada linha da divisão da comissão antes de salvar.';
      setCommError(msg);
      toast.error(msg);
      return false;
    }
    if (!previewDistribuicao.calculo_valido) {
      setCommError(previewDistribuicao.inconsistencias[0]);
      toast.error(previewDistribuicao.inconsistencias[0]);
      return false;
    }
    const payload = commRows.map((r) => ({
      id: r._new ? null : r.id,
      papel: r.papel,
      nome: r.nome || null,
      user_id: r.user_id || null,
      percentual: r.percentual,
      valor: r.valor,
      sem_cadastro_confirmado: !!r.sem_cadastro_confirmado,
    }));
    const { data, error } = await supabase.rpc("salvar_divisao_comissao_lancamento", {
      p_sale_id: saleId,
      p_linhas: payload,
    });
    if (error) {
      setCommError(error.message);
      toast.error(error.message);
      return false;
    }
    // Resincroniza com os ids reais devolvidos pela RPC (troca os ids temporários "new-..." gerados
    // no cliente pras linhas novas) — sem isso, a próxima edição tentaria inserir de novo em vez de
    // atualizar.
    const linhas = (data as any)?.linhas ?? [];
    setCommRows(linhas.map((r: any) => ({ ...r })));
    setDistribuicao(data ?? null);
    setCommError(null);
    setCommDirty(false);
    await onChange();
    await loadHistorico();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commRows, previewDistribuicao, saleId, onChange]);
  useAutosave(canEdit && commDirty, [commRows], saveComm);

  // ----- Enviar ao financeiro -----
  const [sending, setSending] = useState(false);
  const anyDirty = dirty || partiesDirty || paymentDirty || commDirty;
  const enviarFinanceiro = async () => {
    if (anyDirty) {
      toast.error("Aguarde salvar as últimas alterações antes de enviar (alguns segundos).");
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.rpc("criar_ocorrencia_lancamento", { p_sale_id: saleId });
      if (error) {
        toast.error(error.message);
        return;
      }
      notifySaleStatusChange({ data: { saleId, status: "ocorrencia_analise_financeiro" } }).catch(
        () => {},
      );
      toast.success(
        isResend ? "Lançamento reenviado ao financeiro" : "Lançamento enviado ao financeiro",
      );
      await onChange();
      await loadHistorico();
    } finally {
      setSending(false);
    }
  };

  const distribuicaoExibida = canEdit ? previewDistribuicao : distribuicao;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/vendas" })}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <StatusBadge status={sale.status} />
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {sale.imovel_id || `Lançamento #${sale.id.slice(0, 8)}`}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Venda de lançamento — em parceria com construtora.
        </p>
      </div>

      {sale.status === "devolvida_ajuste" && (
        <div className="flex gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>O financeiro devolveu este lançamento para ajuste.</b>
            {motivoDevolucao && <p className="mt-1">{motivoDevolucao}</p>}
          </div>
        </div>
      )}

      {canEdit && (
        <>
          <SaleSection title="Imóvel e negociação">
            {formError && (
              <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                Não foi possível salvar o Resumo: {formError}
              </p>
            )}
            <FieldGrid>
              <Field label="Código do imóvel">
                <Input
                  value={form.imovel_id}
                  disabled={!canEdit}
                  onChange={(e) => upd({ imovel_id: e.target.value })}
                />
              </Field>
              <Field label="Data de assinatura">
                <Input
                  type="date"
                  value={form.data_assinatura ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => upd({ data_assinatura: e.target.value || null })}
                />
              </Field>
              <Field label="Mídia">
                <Select
                  value={form.midia || undefined}
                  disabled={!canEdit}
                  onValueChange={(v) => upd({ midia: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {MIDIA_OPTIONS.map((m) => (
                      <SelectItem key={m.key} value={m.key}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Nota fiscal obrigatória">
                <div className="flex h-9 items-center gap-2">
                  <Switch
                    checked={form.nota_fiscal_obrigatoria}
                    disabled={!canEdit}
                    onCheckedChange={(v) => upd({ nota_fiscal_obrigatoria: v })}
                  />
                  <span className="text-sm text-muted-foreground">
                    {form.nota_fiscal_obrigatoria ? "Sim" : "Não"}
                  </span>
                </div>
              </Field>
            </FieldGrid>
          </SaleSection>

          <SaleSection title="Construtora">
            <FieldGrid>
              <Field label="Nome da construtora">
                <Input
                  value={partiesForm.vendedor_1?.razao_social ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => updParty("vendedor_1", { razao_social: e.target.value })}
                />
              </Field>
              <Field label="CNPJ">
                <Input
                  value={partiesForm.vendedor_1?.cnpj ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => updParty("vendedor_1", { cnpj: e.target.value })}
                />
              </Field>
              <Field label="E-mail">
                <Input
                  type="email"
                  value={partiesForm.vendedor_1?.email ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => updParty("vendedor_1", { email: e.target.value })}
                />
              </Field>
              <Field label="Celular">
                <Input
                  value={partiesForm.vendedor_1?.telefone ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => updParty("vendedor_1", { telefone: e.target.value })}
                />
              </Field>
            </FieldGrid>
          </SaleSection>

          <SaleSection title="Comprador(es)">
            <div className="space-y-4">
              {["comprador_1", ...compradorNums.map((n) => `comprador_${n}`)].map((papel, i) => (
                <div key={papel} className={i > 0 ? "border-t pt-4" : ""}>
                  <FieldGrid>
                    <Field label="Nome">
                      <Input
                        value={partiesForm[papel]?.nome ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => updParty(papel, { nome: e.target.value })}
                      />
                    </Field>
                    <Field label="CPF/CNPJ">
                      <Input
                        value={partiesForm[papel]?.cpf_cnpj ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => updParty(papel, { cpf_cnpj: e.target.value })}
                      />
                    </Field>
                    <Field label="RG">
                      <Input
                        value={partiesForm[papel]?.rg ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => updParty(papel, { rg: e.target.value })}
                      />
                    </Field>
                    <Field label="E-mail">
                      <Input
                        type="email"
                        value={partiesForm[papel]?.email ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => updParty(papel, { email: e.target.value })}
                      />
                    </Field>
                    <Field label="Celular">
                      <Input
                        value={partiesForm[papel]?.telefone ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => updParty(papel, { telefone: e.target.value })}
                      />
                    </Field>
                  </FieldGrid>
                </div>
              ))}
              {canEdit && (
                <Button size="sm" variant="outline" onClick={addComprador}>
                  <Plus className="mr-1 h-4 w-4" />
                  Adicionar comprador
                </Button>
              )}
            </div>
          </SaleSection>

          <SaleSection title="Resumo da transação">
            <FieldGrid>
              <Field label="Valor anunciado">
                <CurrencyInput
                  value={form.valor_anunciado}
                  disabled={!canEdit}
                  onChange={(v) => upd({ valor_anunciado: v })}
                />
              </Field>
              <Field label="Valor negociado">
                <CurrencyInput
                  value={form.valor_negociado}
                  disabled={!canEdit}
                  onChange={(v) => upd({
                    valor_negociado: v,
                    percentual_comissao: form.valor_total_comissao != null && v != null && v > 0
                      ? Number(((Number(form.valor_total_comissao) / v) * 100).toFixed(6))
                      : null,
                  })}
                />
              </Field>
              <Field label="Percentual de comissão (referência)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.percentual_comissao ?? ""}
                  disabled
                />
              </Field>
              <Field label="Valor total da comissão">
                <CurrencyInput
                  value={form.valor_total_comissao}
                  disabled={!canEdit}
                  onChange={(v) => upd({
                    valor_total_comissao: v,
                    percentual_comissao: v != null && Number(form.valor_negociado ?? 0) > 0
                      ? Number(((v / Number(form.valor_negociado)) * 100).toFixed(6))
                      : null,
                  })}
                />
              </Field>
              <Field label="Prêmio">
                <CurrencyInput
                  value={form.premio_valor}
                  disabled={!canEdit}
                  onChange={(v) => upd({ premio_valor: v })}
                />
              </Field>
            </FieldGrid>
          </SaleSection>

          <PaymentStep
            saleId={saleId}
            payment={payment}
            valorNegociado={form.valor_negociado}
            editable={canEdit}
            onSaved={onChange}
            registerSaver={() => {}}
            onDirtyChange={setPaymentDirty}
          />

          <SaleSection title="Divisão da comissão">
            <div className="space-y-3">
              {commError && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                  {commError}
                </p>
              )}
              {commRows.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhuma linha adicionada.</p>
              )}
              {commRows.map((c) => (
                <div
                  key={c.id}
                  className="grid grid-cols-1 items-end gap-2 rounded-md border p-3 md:grid-cols-12"
                >
                  <div className="md:col-span-3">
                    <Label className="mb-1 block text-xs text-muted-foreground">Papel</Label>
                    <Select
                      value={c.papel}
                      disabled={!canEdit}
                      onValueChange={(v) => updComm(c.id, { papel: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LANCAMENTO_COMISSAO_PAPEIS.map((p) => (
                          <SelectItem key={p.key} value={p.key}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-4 space-y-1">
                    <Label className="mb-1 block text-xs text-muted-foreground">Nome</Label>
                    {(() => {
                      const foraDaLista =
                        !!c.user_id && !pessoasAtivas.some((p) => p.id === c.user_id);
                      return (
                        <Select
                          value={valorSelectBeneficiario(c)}
                          disabled={!canEdit}
                          onValueChange={(v) =>
                            updComm(c.id, resolverSelecaoBeneficiario(v, pessoasAtivas, c.nome))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um beneficiário" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SEM_CADASTRO_VALUE}>
                              Sem cadastro / parceiro externo (digitar nome)
                            </SelectItem>
                            {foraDaLista && (
                              <SelectItem value={c.user_id}>{c.nome} (inativo)</SelectItem>
                            )}
                            {pessoasAtivas.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}
                    <Input
                      value={c.nome ?? ""}
                      disabled={!canEdit || !!c.user_id}
                      placeholder={c.user_id ? undefined : "Nome de quem não tem cadastro"}
                      onChange={(e) => updComm(c.id, { nome: e.target.value })}
                    />
                    {!c.user_id && c.sem_cadastro_confirmado && (
                      <p className="text-xs text-muted-foreground">
                        Parceria externa — fora do ranking por pessoa, dentro da distribuição.
                      </p>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <Label className="mb-1 block text-xs text-muted-foreground">%</Label>
                    <Input
                      type="number"
                      step="0.001"
                      value={c.percentual ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => {
                        const percentual = e.target.value ? Number(e.target.value) : null;
                        const base =
                          previewDistribuicao.comissao_bruta + previewDistribuicao.premio_valor;
                        updComm(c.id, {
                          percentual,
                          valor:
                            percentual != null && base > 0
                              ? Number(((percentual / 100) * base).toFixed(2))
                              : c.valor,
                        });
                      }}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="mb-1 block text-xs text-muted-foreground">Valor (R$)</Label>
                    <CurrencyInput
                      value={c.valor}
                      disabled={!canEdit}
                      onChange={(v) => {
                        const base =
                          previewDistribuicao.comissao_bruta + previewDistribuicao.premio_valor;
                        updComm(c.id, {
                          valor: v,
                          percentual:
                            v != null && base > 0
                              ? Number(((v / base) * 100).toFixed(3))
                              : c.percentual,
                        });
                      }}
                    />
                  </div>
                  {canEdit && (
                    <div className="md:col-span-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => delComm(c.id)}
                        className="w-full"
                      >
                        ×
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {canEdit && (
                <Button size="sm" variant="outline" onClick={addComm}>
                  <Plus className="mr-1 h-4 w-4" />
                  Adicionar linha
                </Button>
              )}

              <DistribuicaoResumo dist={distribuicaoExibida} />
            </div>
          </SaleSection>

          <SaleSection title="Previsão de recebimento da comissão">
            <p className="mb-3 text-sm text-muted-foreground">
              Informe até três recebimentos. Em cada parcela, preencha valor, data e forma de
              pagamento.
            </p>
            <FieldGrid>
              <Field label="1ª parcela — valor">
                <CurrencyInput
                  value={form.previsao_recebimento_valor}
                  disabled={!canEdit}
                  onChange={(v) => upd({ previsao_recebimento_valor: v })}
                />
              </Field>
              <Field label="1ª parcela — data">
                <Input
                  type="date"
                  value={form.previsao_recebimento_data ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => upd({ previsao_recebimento_data: e.target.value || null })}
                />
              </Field>
              <Field label="1ª parcela — forma de pagamento" colSpan={2}>
                <Input
                  value={form.previsao_recebimento_forma ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => upd({ previsao_recebimento_forma: e.target.value })}
                />
              </Field>
              <Field label="2ª parcela — valor">
                <CurrencyInput
                  value={form.previsao_recebimento2_valor}
                  disabled={!canEdit}
                  onChange={(v) => upd({ previsao_recebimento2_valor: v })}
                />
              </Field>
              <Field label="2ª parcela — data">
                <Input
                  type="date"
                  value={form.previsao_recebimento2_data ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => upd({ previsao_recebimento2_data: e.target.value || null })}
                />
              </Field>
              <Field label="2ª parcela — forma de pagamento" colSpan={2}>
                <Input
                  value={form.previsao_recebimento2_forma ?? ""}
                  disabled={!canEdit}
                  placeholder="PIX, TED, boleto..."
                  onChange={(e) => upd({ previsao_recebimento2_forma: e.target.value })}
                />
              </Field>
              <Field label="3ª parcela — valor">
                <CurrencyInput
                  value={form.previsao_recebimento3_valor}
                  disabled={!canEdit}
                  onChange={(v) => upd({ previsao_recebimento3_valor: v })}
                />
              </Field>
              <Field label="3ª parcela — data">
                <Input
                  type="date"
                  value={form.previsao_recebimento3_data ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => upd({ previsao_recebimento3_data: e.target.value || null })}
                />
              </Field>
              <Field label="3ª parcela — forma de pagamento" colSpan={2}>
                <Input
                  value={form.previsao_recebimento3_forma ?? ""}
                  disabled={!canEdit}
                  placeholder="PIX, TED, boleto..."
                  onChange={(e) => upd({ previsao_recebimento3_forma: e.target.value })}
                />
              </Field>
            </FieldGrid>
          </SaleSection>

          <SaleSection title="Observações">
            <Textarea
              value={form.negociacao_observacoes ?? ""}
              disabled={!canEdit}
              onChange={(e) => upd({ negociacao_observacoes: e.target.value })}
              rows={4}
            />
          </SaleSection>
        </>
      )}

      {!canEdit && loadingOcc && (
        <p className="py-8 text-center text-sm text-muted-foreground">Carregando ocorrência...</p>
      )}

      {!canEdit && !editOcc && !loadingOcc && occ && (
        <div className="rounded-lg border p-4 print:border-0 print:p-0">
          <div className="mb-3 flex justify-end gap-2 print:hidden">
            {canEditFinanceiro && (
              <Button variant="outline" size="sm" onClick={abrirEdicaoFinanceiro}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir / baixar
            </Button>
          </div>
          <OccurrenceReportBody
            sale={sale}
            occ={occ}
            commissions={occCommissions}
            partners={[]}
            parties={parties}
            distribuicao={distribuicao}
            papeis={LANCAMENTO_COMISSAO_PAPEIS}
          />
          <div className="mt-4 border-t pt-4">
            <DistribuicaoResumo dist={distribuicao} />
          </div>
        </div>
      )}

      {canEditFinanceiro && editOcc && !loadingOcc && occ && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <p className="text-sm text-muted-foreground">
              Editando a ocorrência — nada é salvo até confirmar com um motivo.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOcc(false)}
              disabled={salvandoEdicao}
            >
              Fechar edição
            </Button>
          </div>

          <SaleSection title="Resumo da transação">
            <FieldGrid>
              <Field label="Código do imóvel">
                <Input
                  value={editResumo.imovel_id ?? ""}
                  onChange={(e) => updEditResumo({ imovel_id: e.target.value })}
                />
              </Field>
              <Field label="Tempo de venda (dias)">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={editResumo.tempo_venda_dias ?? ""}
                  onChange={(e) =>
                    updEditResumo({
                      tempo_venda_dias: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder="Ex: 45"
                />
              </Field>
              <Field label="Data de assinatura">
                <Input
                  type="date"
                  value={editResumo.data_assinatura ?? ""}
                  onChange={(e) => updEditResumo({ data_assinatura: e.target.value || null })}
                />
              </Field>
              <Field label="Mídia">
                <Select
                  value={editResumo.midia ?? "none"}
                  onValueChange={(v) => updEditResumo({ midia: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o canal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {MIDIA_OPTIONS.map((m) => (
                      <SelectItem key={m.key} value={m.key}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Nota fiscal obrigatória">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={!!editResumo.nota_fiscal_obrigatoria}
                    onCheckedChange={(v) => updEditResumo({ nota_fiscal_obrigatoria: v })}
                  />
                  <span className="text-sm text-muted-foreground">
                    {editResumo.nota_fiscal_obrigatoria ? "Sim" : "Não"}
                  </span>
                </div>
              </Field>
              <Field label="Valor anunciado">
                <CurrencyInput
                  value={editResumo.valor_anunciado}
                  onChange={(v) => updEditResumo({ valor_anunciado: v })}
                />
              </Field>
              <Field label="Valor negociado">
                <CurrencyInput
                  value={editResumo.valor_negociado}
                  onChange={(v) => updEditResumo({
                    valor_negociado: v,
                    percentual_comissao: editResumo.valor_total_comissao != null && v != null && v > 0
                      ? Number(((Number(editResumo.valor_total_comissao) / v) * 100).toFixed(6))
                      : null,
                  })}
                />
              </Field>
              <Field label="Percentual de comissão (referência)">
                <Input
                  type="number"
                  step="0.01"
                  value={editResumo.percentual_comissao ?? ""}
                  disabled
                />
              </Field>
              <Field label="Valor total da comissão">
                <CurrencyInput
                  value={editResumo.valor_total_comissao}
                  onChange={(v) => updEditResumo({
                    valor_total_comissao: v,
                    percentual_comissao: v != null && Number(editResumo.valor_negociado ?? 0) > 0
                      ? Number(((v / Number(editResumo.valor_negociado)) * 100).toFixed(6))
                      : null,
                  })}
                />
              </Field>
              <Field label="Prêmio">
                <CurrencyInput
                  value={editResumo.premio_valor}
                  onChange={(v) => updEditResumo({ premio_valor: v })}
                />
              </Field>
              <Field label="Observações" colSpan={2}>
                <Textarea
                  value={editResumo.negociacao_observacoes ?? ""}
                  onChange={(e) => updEditResumo({ negociacao_observacoes: e.target.value })}
                />
              </Field>
            </FieldGrid>
          </SaleSection>

          <SaleSection title="Previsão de recebimento da comissão">
            <p className="mb-3 text-sm text-muted-foreground">
              Informe até três recebimentos. Em cada parcela, preencha valor, data e forma de
              pagamento.
            </p>
            <FieldGrid>
              <Field label="1ª parcela — valor">
                <CurrencyInput
                  value={editResumo.previsao_recebimento_valor}
                  onChange={(v) => updEditResumo({ previsao_recebimento_valor: v })}
                />
              </Field>
              <Field label="1ª parcela — data">
                <Input
                  type="date"
                  value={editResumo.previsao_recebimento_data ?? ""}
                  onChange={(e) =>
                    updEditResumo({ previsao_recebimento_data: e.target.value || null })
                  }
                />
              </Field>
              <Field label="1ª parcela — forma de pagamento" colSpan={2}>
                <Input
                  value={editResumo.previsao_recebimento_forma ?? ""}
                  placeholder="PIX, TED, boleto..."
                  onChange={(e) => updEditResumo({ previsao_recebimento_forma: e.target.value })}
                />
              </Field>
              <Field label="2ª parcela — valor">
                <CurrencyInput
                  value={editResumo.previsao_recebimento2_valor}
                  onChange={(v) => updEditResumo({ previsao_recebimento2_valor: v })}
                />
              </Field>
              <Field label="2ª parcela — data">
                <Input
                  type="date"
                  value={editResumo.previsao_recebimento2_data ?? ""}
                  onChange={(e) =>
                    updEditResumo({ previsao_recebimento2_data: e.target.value || null })
                  }
                />
              </Field>
              <Field label="2ª parcela — forma de pagamento" colSpan={2}>
                <Input
                  value={editResumo.previsao_recebimento2_forma ?? ""}
                  placeholder="PIX, TED, boleto..."
                  onChange={(e) => updEditResumo({ previsao_recebimento2_forma: e.target.value })}
                />
              </Field>
              <Field label="3ª parcela — valor">
                <CurrencyInput
                  value={editResumo.previsao_recebimento3_valor}
                  onChange={(v) => updEditResumo({ previsao_recebimento3_valor: v })}
                />
              </Field>
              <Field label="3ª parcela — data">
                <Input
                  type="date"
                  value={editResumo.previsao_recebimento3_data ?? ""}
                  onChange={(e) =>
                    updEditResumo({ previsao_recebimento3_data: e.target.value || null })
                  }
                />
              </Field>
              <Field label="3ª parcela — forma de pagamento" colSpan={2}>
                <Input
                  value={editResumo.previsao_recebimento3_forma ?? ""}
                  placeholder="PIX, TED, boleto..."
                  onChange={(e) => updEditResumo({ previsao_recebimento3_forma: e.target.value })}
                />
              </Field>
            </FieldGrid>
          </SaleSection>

          <SaleSection title="Financiamento">
            <FieldGrid>
              <Field label="Tem financiamento?">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={!!editFinanciamento.financiamento}
                    onCheckedChange={(v) => updEditFinanciamento({ financiamento: v })}
                  />
                  <span className="text-sm text-muted-foreground">
                    {editFinanciamento.financiamento ? "Sim" : "Não"}
                  </span>
                </div>
              </Field>
              <Field label="Valor financiado">
                <CurrencyInput
                  value={editFinanciamento.financiamento_valor}
                  disabled={!editFinanciamento.financiamento}
                  onChange={(v) => updEditFinanciamento({ financiamento_valor: v })}
                />
              </Field>
              <Field label="Banco">
                <Input
                  value={editFinanciamento.financiamento_banco ?? ""}
                  disabled={!editFinanciamento.financiamento}
                  onChange={(e) => updEditFinanciamento({ financiamento_banco: e.target.value })}
                />
              </Field>
              <Field label="Correspondente bancário">
                <Input
                  value={editFinanciamento.financiamento_correspondente ?? ""}
                  disabled={!editFinanciamento.financiamento}
                  onChange={(e) =>
                    updEditFinanciamento({ financiamento_correspondente: e.target.value })
                  }
                />
              </Field>
              <Field label="Previsão de liberação">
                <Input
                  type="date"
                  value={editFinanciamento.financiamento_previsao ?? ""}
                  disabled={!editFinanciamento.financiamento}
                  onChange={(e) =>
                    updEditFinanciamento({ financiamento_previsao: e.target.value || null })
                  }
                />
              </Field>
              <Field label="Oba Crédito">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={!!editFinanciamento.oba_credito}
                    onCheckedChange={(v) => updEditFinanciamento({ oba_credito: v })}
                    disabled={!editFinanciamento.financiamento}
                  />
                  <span className="text-sm text-muted-foreground">
                    {editFinanciamento.oba_credito ? "Sim" : "Não"}
                  </span>
                </div>
              </Field>
            </FieldGrid>
          </SaleSection>

          <SaleSection title="Divisão de comissão">
            <div className="space-y-3">
              {editLinhas.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhuma linha adicionada.</p>
              )}
              {editLinhas.map((c) => (
                <div
                  key={c.id}
                  className="grid grid-cols-1 items-end gap-2 rounded-md border p-3 md:grid-cols-12"
                >
                  <div className="md:col-span-3">
                    <Label className="mb-1 block text-xs text-muted-foreground">Papel</Label>
                    <Select value={c.papel} onValueChange={(v) => updEditLinha(c.id, { papel: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LANCAMENTO_COMISSAO_PAPEIS.map((p) => (
                          <SelectItem key={p.key} value={p.key}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-4 space-y-1">
                    <Label className="mb-1 block text-xs text-muted-foreground">Nome</Label>
                    {(() => {
                      const foraDaLista =
                        !!c.user_id && !pessoasAtivas.some((p) => p.id === c.user_id);
                      return (
                        <Select
                          value={valorSelectBeneficiario(c)}
                          onValueChange={(v) =>
                            updEditLinha(
                              c.id,
                              resolverSelecaoBeneficiario(v, pessoasAtivas, c.nome),
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione um beneficiário" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SEM_CADASTRO_VALUE}>
                              Sem cadastro / parceiro externo (digitar nome)
                            </SelectItem>
                            {foraDaLista && (
                              <SelectItem value={c.user_id}>{c.nome} (inativo)</SelectItem>
                            )}
                            {pessoasAtivas.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}
                    <Input
                      value={c.nome ?? ""}
                      disabled={!!c.user_id}
                      placeholder={c.user_id ? undefined : "Nome de quem não tem cadastro"}
                      onChange={(e) => updEditLinha(c.id, { nome: e.target.value })}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="mb-1 block text-xs text-muted-foreground">%</Label>
                    <Input
                      type="number"
                      step="0.001"
                      value={c.percentual ?? ""}
                      onChange={(e) => {
                        const percentual = e.target.value ? Number(e.target.value) : null;
                        const base = editPreviewDist.comissao_bruta + editPreviewDist.premio_valor;
                        updEditLinha(c.id, {
                          percentual,
                          valor:
                            percentual != null && base > 0
                              ? Number(((percentual / 100) * base).toFixed(2))
                              : c.valor,
                        });
                      }}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="mb-1 block text-xs text-muted-foreground">Valor (R$)</Label>
                    <CurrencyInput
                      value={c.valor}
                      onChange={(v) => {
                        const base = editPreviewDist.comissao_bruta + editPreviewDist.premio_valor;
                        updEditLinha(c.id, {
                          valor: v,
                          percentual:
                            v != null && base > 0
                              ? Number(((v / base) * 100).toFixed(3))
                              : c.percentual,
                        });
                      }}
                    />
                  </div>
                  <div className="md:col-span-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => delEditLinha(c.id)}
                      className="w-full"
                    >
                      ×
                    </Button>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={addEditLinha}>
                <Plus className="mr-1 h-4 w-4" />
                Adicionar linha
              </Button>
            </div>
          </SaleSection>

          <div className="border-t pt-4">
            <DistribuicaoResumo dist={editPreviewDist} />
          </div>

          <div className="flex justify-end">
            <Button onClick={() => setEditMotivoOpen(true)} disabled={salvandoEdicao}>
              {salvandoEdicao ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar edição
            </Button>
          </div>
        </div>
      )}

      <Dialog open={editMotivoOpen} onOpenChange={setEditMotivoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar edição da ocorrência</DialogTitle>
            <DialogDescription>
              Explique o motivo da alteração — fica registrado na auditoria junto com o que mudou.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editMotivo}
            onChange={(e) => setEditMotivo(e.target.value)}
            placeholder="Ex: corretor informou valor negociado errado, corrigido conforme contrato."
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditMotivoOpen(false)}
              disabled={salvandoEdicao}
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmarSalvarEdicaoFinanceiro}
              disabled={!editMotivo.trim() || salvandoEdicao}
            >
              {salvandoEdicao ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar e salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canEdit && (
        <div className="flex items-center justify-between gap-3">
          <AutosaveStatus saving={false} dirty={anyDirty} />
          <Button onClick={enviarFinanceiro} disabled={sending || anyDirty}>
            {sending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {isResend ? "Reenviar ao financeiro" : "Enviar ao financeiro"}
          </Button>
        </div>
      )}

      {!canEdit && !editOcc && isFinanceiro && sale.status === "ocorrencia_analise_financeiro" && (
        <div className="flex items-center justify-between gap-3 rounded-md border p-3 print:hidden">
          <p className="text-sm text-muted-foreground">
            Ocorrência em análise — devolva pro corretor/coordenador corrigir, edite direto, ou
            conclua.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setReturnOpen(true)}>
              <XCircle className="mr-2 h-4 w-4" />
              Devolver
            </Button>
            <Button
              onClick={openConcluir}
              disabled={!!distribuicao && !distribuicao.calculo_valido}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Concluir ocorrência
            </Button>
          </div>
        </div>
      )}
      {!canEdit &&
        !editOcc &&
        isFinanceiro &&
        sale.status === "ocorrencia_analise_financeiro" &&
        distribuicao &&
        !distribuicao.calculo_valido && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive print:hidden">
            <p className="font-medium">Não é possível concluir com a distribuição atual:</p>
            <ul className="mt-1 list-inside list-disc">
              {(distribuicao.inconsistencias ?? []).map((msg: string, i: number) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

      {!canEdit && isFinanceiro && sale.status === "ocorrencia_concluida" && (
        <div className="flex items-center justify-between gap-3 rounded-md border p-3 print:hidden">
          <p className="text-sm text-muted-foreground">
            Ocorrência concluída.
            {sale.lancamento_saldo_imobiliaria != null &&
              ` Saldo confirmado da imobiliária/construtora: ${money(sale.lancamento_saldo_imobiliaria)}.`}
          </p>
          <Button variant="outline" onClick={() => setReopenOpen(true)}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reabrir ocorrência
          </Button>
        </div>
      )}

      {!canEdit && !loadingOcc && !occ && (
        <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
          Este lançamento já foi enviado ao financeiro e não pode mais ser editado por aqui.
        </div>
      )}

      <SaleSection title="Histórico de status">
        <div className="space-y-2">
          {history.length === 0 && (
            <p className="text-sm text-muted-foreground">Sem alterações registradas.</p>
          )}
          {history.map((h) => (
            <div
              key={h.id}
              className="flex items-center justify-between rounded-md border p-2 text-sm"
            >
              <span>
                {h.de ? (STATUS_LABEL[h.de as SaleStatus] ?? h.de) : "—"} →{" "}
                <span className="font-medium">{STATUS_LABEL[h.para as SaleStatus] ?? h.para}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(h.created_at).toLocaleString("pt-BR")}
              </span>
            </div>
          ))}
        </div>
      </SaleSection>

      <SaleSection title="Atividade">
        <div className="space-y-2">
          {activity.length === 0 && (
            <p className="text-sm text-muted-foreground">Sem atividade registrada.</p>
          )}
          {activity.map((a) => {
            const d = describeAtividadeLancamento(a.acao, a.payload);
            return (
              <div key={a.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{d.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString("pt-BR")}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{a.autor_id ? (activityAuthorNames[a.autor_id] ?? "...") : "Sistema"}</span>
                  {d.detail && <span className="truncate">{d.detail}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </SaleSection>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Devolver lançamento para ajuste</DialogTitle>
            <DialogDescription>
              Descreva o motivo. O corretor/coordenador que enviou será notificado.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Motivo da devolução (obrigatório)"
            value={returnMotivo}
            onChange={(e) => setReturnMotivo(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReturnOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitReturn} disabled={!returnMotivo.trim() || returning}>
              {returning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Devolver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={concludeOpen}
        onOpenChange={(o) => {
          if (!concluding) setConcludeOpen(o);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar conclusão do lançamento</DialogTitle>
            <DialogDescription>
              Confira o saldo que fica com a imobiliária/construtora antes de concluir — depois de
              confirmado, essa distribuição fica registrada no histórico.
            </DialogDescription>
          </DialogHeader>
          {concludeLoading && <p className="text-sm text-muted-foreground">Recalculando...</p>}
          {!concludeLoading && concludeDist && (
            <div className="space-y-3">
              <DistribuicaoResumo dist={concludeDist} />
              {!concludeDist.calculo_valido && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <ul className="list-inside list-disc">
                    {(concludeDist.inconsistencias ?? []).map((msg: string, i: number) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConcludeOpen(false)} disabled={concluding}>
              Cancelar
            </Button>
            <Button
              onClick={confirmarConcluir}
              disabled={concluding || concludeLoading || !concludeDist?.calculo_valido}
            >
              {concluding ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Confirmar saldo e concluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reabrir ocorrência</DialogTitle>
            <DialogDescription>Descreva o motivo da reabertura.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Motivo (obrigatório)"
            value={reopenMotivo}
            onChange={(e) => setReopenMotivo(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReopenOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitReopen} disabled={!reopenMotivo.trim() || reopening}>
              {reopening ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Reabrir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Bloco read-only com os 5 números que a auditoria pediu — comissão bruta, total às pessoas,
 * parceria externa, saldo da imobiliária/construtora (sempre calculado, nunca digitado) e diferença.
 * Reaproveitado nos 3 lugares que precisam mostrar a mesma distribuição (formulário editável, relatório
 * da ocorrência, diálogo de conclusão) — um só componente, um só formato de número. */
function DistribuicaoResumo({ dist }: { dist: any }) {
  if (!dist) return null;
  const linha = (label: string, valor: number | null | undefined, destaque?: boolean) => (
    <div
      className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${destaque ? "bg-muted font-medium" : ""}`}
    >
      <span className={destaque ? "" : "text-muted-foreground"}>{label}</span>
      <span>{money(valor) ?? "R$ 0,00"}</span>
    </div>
  );
  return (
    <div className="space-y-1 rounded-md border">
      {linha("Comissão bruta", dist.comissao_bruta)}
      {dist.premio_valor > 0 && linha("Prêmio", dist.premio_valor)}
      {linha("Total destinado às pessoas", dist.total_pessoas)}
      {linha("Parceria externa (fora do faturamento/ranking)", dist.parceria_externa)}
      {linha("Saldo da imobiliária/construtora (automático)", dist.saldo_imobiliaria, true)}
      <div
        className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${!dist.calculo_valido ? "bg-destructive/10 text-destructive" : "text-muted-foreground"}`}
      >
        <span>Diferença</span>
        <span>{money(dist.diferenca_restante) ?? "R$ 0,00"}</span>
      </div>
      {!dist.calculo_valido && (dist.inconsistencias ?? []).length > 0 && (
        <div className="border-t border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <ul className="list-inside list-disc">
            {dist.inconsistencias.map((msg: string, i: number) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
