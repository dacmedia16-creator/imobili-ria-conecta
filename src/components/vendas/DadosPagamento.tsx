import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { ChevronRight, CreditCard, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import {
  DADOS_VAZIOS,
  PIX_TIPOS,
  STATUS_LABEL,
  normalizarDados,
  normalizarPessoas,
  payloadDados,
  resumoConta,
  statusPessoa,
  validarDados,
  type DadosBancarios,
  type ModoPagamento,
  type PagamentoPessoa,
  type StatusPagamento,
} from "@/lib/dados-pagamento";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Dados para pagamento da equipe (card t_a4ef3b48). Tabelas/RPCs da migração 20261016220000, fora
// de types.ts. O banco garante: só o próprio corretor grava os dados dele; completo só para ele,
// admin e financeiro; os demais recebem mascarado.
const db = supabase as unknown as SupabaseClient;

const SELO: Record<StatusPagamento, string> = {
  imobiliaria: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  pendente: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
};

export function SeloPagamento({ status }: { status: StatusPagamento }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SELO[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Campos de conta + PIX (mesmo formulário no cadastro e na venda). */
export function CamposConta({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: DadosBancarios;
  onChange: (v: DadosBancarios) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const set = (patch: Partial<DadosBancarios>) => onChange({ ...value, ...patch });
  const campo = (
    k: keyof DadosBancarios,
    label: string,
    extra?: { placeholder?: string; max?: number },
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`${idPrefix}-${k}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`${idPrefix}-${k}`}
        value={value[k]}
        maxLength={extra?.max}
        placeholder={extra?.placeholder}
        disabled={disabled}
        onChange={(e) => set({ [k]: e.target.value } as Partial<DadosBancarios>)}
      />
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {campo("titular", "Titular da conta", { max: 120 })}
      {campo("documento", "CPF/CNPJ do titular", { max: 20 })}
      <div className="space-y-1">
        <Label className="text-xs">Tipo de chave PIX</Label>
        <Select
          value={value.pix_tipo || undefined}
          onValueChange={(v) => set({ pix_tipo: v as DadosBancarios["pix_tipo"] })}
          disabled={disabled}
        >
          <SelectTrigger aria-label="Tipo de chave PIX">
            <SelectValue placeholder="Escolha" />
          </SelectTrigger>
          <SelectContent>
            {PIX_TIPOS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {campo("pix_chave", "Chave PIX", { max: 120 })}
      {campo("banco", "Banco", { max: 80, placeholder: "Ex.: 341 - Itaú" })}
      <div className="space-y-1">
        <Label className="text-xs">Tipo de conta</Label>
        <Select
          value={value.tipo_conta || undefined}
          onValueChange={(v) => set({ tipo_conta: v as DadosBancarios["tipo_conta"] })}
          disabled={disabled}
        >
          <SelectTrigger aria-label="Tipo de conta">
            <SelectValue placeholder="Escolha" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="corrente">Corrente</SelectItem>
            <SelectItem value="poupanca">Poupança</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {campo("agencia", "Agência", { max: 10 })}
      {campo("conta", "Conta com dígito", { max: 20 })}
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Preencha a chave PIX ou banco, agência e conta.
      </p>
    </div>
  );
}

/** Cartão "Dados para pagamento" no Meu acesso: o próprio corretor mantém a conta salva. */
export function MeusDadosPagamento({ userId }: { userId: string }) {
  const [dados, setDados] = useState<DadosBancarios>({ ...DADOS_VAZIOS });
  const [pelaImob, setPelaImob] = useState(false);
  const [carregado, setCarregado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void db
      .from("corretor_dados_pagamento")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) toast.error("Não foi possível carregar seus dados para pagamento.");
        setDados(normalizarDados(data));
        setPelaImob(data?.recebe_pela_imobiliaria === true);
        setCarregado(true);
      });
    return () => {
      vivo = false;
    };
  }, [userId]);

  const salvar = async () => {
    if (!pelaImob) {
      const erro = validarDados(dados);
      if (erro) return toast.error(erro);
    }
    setSalvando(true);
    const p = payloadDados(dados);
    const row = {
      user_id: userId,
      recebe_pela_imobiliaria: pelaImob,
      titular: p.titular ?? null,
      documento: p.documento ?? null,
      tipo_conta: p.tipo_conta ?? null,
      banco: p.banco ?? null,
      agencia: p.agencia ?? null,
      conta: p.conta ?? null,
      pix_tipo: p.pix_tipo ?? null,
      pix_chave: p.pix_chave ?? null,
    };
    const { error } = await db
      .from("corretor_dados_pagamento")
      .upsert(row, { onConflict: "organization_id,user_id" });
    setSalvando(false);
    if (error) toast.error(errorMessage(error, "Não foi possível salvar."));
    else toast.success("Dados para pagamento salvos.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4" /> Dados para pagamento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Usados para pagar suas comissões. Só você altera. Aparecem completos só para você, o
          financeiro e o administrador.
        </p>
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <p className="font-medium">Recebo através da imobiliária</p>
            <p className="text-xs text-muted-foreground">
              Ligado: a imobiliária recebe e repassa. Não precisa preencher banco.
            </p>
          </div>
          <Switch
            checked={pelaImob}
            onCheckedChange={setPelaImob}
            disabled={!carregado}
            aria-label="Recebo através da imobiliária"
          />
        </div>
        {!pelaImob && (
          <CamposConta
            value={dados}
            onChange={setDados}
            disabled={!carregado}
            idPrefix="meus-dados"
          />
        )}
        <div className="flex justify-end">
          <Button size="sm" onClick={salvar} disabled={!carregado || salvando}>
            {salvando ? "Salvando…" : "Salvar dados para pagamento"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Bloco "💳 Dados para pagamento" da etapa Equipe da venda. */
export function DadosPagamentoEquipe({
  saleId,
  userId,
  podeAlterar,
  equipeKey,
  papeis,
}: {
  saleId: string;
  userId: string;
  /** false quando a venda está encerrada (o banco também trava). */
  podeAlterar: boolean;
  /** Muda quando a equipe salva muda (recarrega a lista). */
  equipeKey: string;
  /** Papel(is) de cada pessoa na etapa Equipe (papeisDaEquipe). */
  papeis: Map<string, string[]>;
}) {
  const [pessoas, setPessoas] = useState<PagamentoPessoa[] | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await db.rpc("venda_dados_pagamento", { _sale_id: saleId });
    if (error) {
      setErro(true);
      setPessoas([]);
      return;
    }
    setErro(false);
    setPessoas(normalizarPessoas(data));
  }, [saleId]);

  useEffect(() => {
    void carregar();
  }, [carregar, equipeKey]);

  return (
    <div className="mt-6 rounded-lg border p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold">💳 Dados para pagamento</h3>
      <p className="mt-1 text-xs text-muted-foreground">Como cada um vai receber.</p>
      <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Dados bancários aparecem completos só para o próprio corretor, financeiro e administrador.
        Os outros veem mascarado. Cada pessoa preenche só os próprios dados.
      </p>
      {pessoas === null ? (
        <p className="mt-3 text-xs text-muted-foreground">Carregando…</p>
      ) : erro ? (
        <p className="mt-3 text-xs text-destructive">
          Não foi possível carregar os dados para pagamento.
        </p>
      ) : pessoas.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Salve a equipe com pessoas cadastradas para ver os dados para pagamento.
        </p>
      ) : (
        <>
          <div className="mt-3 space-y-3">
            {pessoas.map((p) => {
              const st = statusPessoa(p);
              const meu = p.user_id === userId;
              const papel = (papeis.get(p.user_id) ?? []).join(" · ");
              return (
                <details
                  key={p.user_id}
                  open={meu && st === "pendente"}
                  className={`group rounded-md border p-3 ${meu ? "border-primary/40" : "bg-muted/30"}`}
                >
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
                      <span className="text-sm font-semibold">
                        {p.nome}
                        {meu && " (você)"}
                      </span>
                      {papel && <span className="text-xs text-muted-foreground">{papel}</span>}
                    </span>
                    <SeloPagamento status={st} />
                  </summary>
                  {meu ? (
                    <MeuBlocoVenda
                      pessoa={p}
                      saleId={saleId}
                      podeAlterar={podeAlterar}
                      onSalvo={carregar}
                    />
                  ) : (
                    <div className="mt-2">
                      {p.origem !== "nenhum" && p.modo === "conta_propria" && resumoConta(p) && (
                        <p className="text-xs text-muted-foreground">
                          {p.titular && `${p.titular} · `}
                          {resumoConta(p)}
                        </p>
                      )}
                      {st === "imobiliaria" && (
                        <p className="text-xs text-muted-foreground">
                          A imobiliária recebe e repassa.
                        </p>
                      )}
                      {st === "pendente" && (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          Só {p.nome.split(" ")[0]} pode preencher. Peça para abrir esta venda ou o
                          Meu acesso e completar.
                        </p>
                      )}
                    </div>
                  )}
                </details>
              );
            })}
          </div>
          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Como cada um vai receber
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Pessoa</th>
                    <th className="py-1 pr-3 font-medium">Papel</th>
                    <th className="py-1 pr-3 font-medium">Recebe</th>
                    <th className="py-1 font-medium">Conta/PIX</th>
                  </tr>
                </thead>
                <tbody>
                  {pessoas.map((p) => {
                    const st = statusPessoa(p);
                    return (
                      <tr key={p.user_id} className="border-t">
                        <td className="py-1.5 pr-3 font-medium">{p.nome}</td>
                        <td className="py-1.5 pr-3">
                          {(papeis.get(p.user_id) ?? []).join(" · ") || "—"}
                        </td>
                        <td className="py-1.5 pr-3">
                          <SeloPagamento status={st} />
                        </td>
                        <td className="py-1.5">
                          {st === "ok"
                            ? resumoConta(p) || "—"
                            : st === "imobiliaria"
                              ? "Conta da imobiliária"
                              : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MeuBlocoVenda({
  pessoa,
  saleId,
  podeAlterar,
  onSalvo,
}: {
  pessoa: PagamentoPessoa;
  saleId: string;
  podeAlterar: boolean;
  onSalvo: () => Promise<void>;
}) {
  const [modo, setModo] = useState<ModoPagamento>(pessoa.modo);
  // Já tem conta no cadastro e a venda ainda não tem cópia própria diferente: sugere usar a salva.
  const [usarCadastro, setUsarCadastro] = useState(
    pessoa.tem_cadastro && pessoa.origem !== "venda",
  );
  const [dados, setDados] = useState<DadosBancarios>(normalizarDados(pessoa));
  const [salvarCadastro, setSalvarCadastro] = useState(!pessoa.tem_cadastro);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    const usar = modo === "conta_propria" && usarCadastro && pessoa.tem_cadastro;
    if (modo === "conta_propria" && !usar) {
      const e = validarDados(dados);
      if (e) return toast.error(e);
    }
    setSalvando(true);
    const { error } = await db.rpc("salvar_meus_dados_pagamento_venda", {
      _sale_id: saleId,
      _modo: modo,
      _usar_cadastro: usar,
      _dados: modo === "conta_propria" && !usar ? payloadDados(dados) : {},
      _salvar_cadastro: modo === "conta_propria" && !usar && salvarCadastro,
    });
    setSalvando(false);
    if (error) return toast.error(errorMessage(error, "Não foi possível salvar."));
    toast.success("Seus dados para pagamento nesta venda foram salvos.");
    await onSalvo();
  };

  return (
    <div className="mt-2">
      {pessoa.origem === "cadastro" && (
        <p className="mt-1 text-xs text-muted-foreground">
          Usando o que está no seu cadastro. Salve para confirmar nesta venda.
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-md border p-3">
        <div>
          <p className="text-sm font-medium">Vai receber através da imobiliária</p>
          <p className="text-xs text-muted-foreground">
            Ligado: a imobiliária recebe e repassa. Não precisa preencher banco.
          </p>
        </div>
        <Switch
          checked={modo === "imobiliaria"}
          onCheckedChange={(v) => setModo(v ? "imobiliaria" : "conta_propria")}
          disabled={!podeAlterar}
          aria-label="Vai receber através da imobiliária"
        />
      </div>
      {modo === "conta_propria" && (
        <div className="mt-3 space-y-3">
          {pessoa.tem_cadastro ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={usarCadastro}
                onCheckedChange={(v) => setUsarCadastro(v === true)}
                disabled={!podeAlterar}
              />
              Usar a conta já salva no meu cadastro
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">
              Ainda não tem conta salva no cadastro. O que preencher aqui pode ser salvo para as
              próximas vendas.
            </p>
          )}
          {usarCadastro && pessoa.tem_cadastro ? (
            pessoa.origem === "cadastro" &&
            resumoConta(pessoa) && (
              <p className="text-xs text-muted-foreground">{resumoConta(pessoa)}</p>
            )
          ) : (
            <>
              <CamposConta
                value={dados}
                onChange={setDados}
                disabled={!podeAlterar}
                idPrefix={`venda-${pessoa.user_id}`}
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={salvarCadastro}
                  onCheckedChange={(v) => setSalvarCadastro(v === true)}
                  disabled={!podeAlterar}
                />
                Salvar no meu cadastro para as próximas vendas
              </label>
            </>
          )}
        </div>
      )}
      {podeAlterar ? (
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar meus dados nesta venda"}
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Venda encerrada: dados travados.</p>
      )}
    </div>
  );
}
