import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wizard } from "@/components/Wizard";
import { parteLabel, parteSortKey } from "@/lib/status";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft, UserCheck } from "lucide-react";
import { type Saver, useAutosave, AutosaveStatus, FieldGrid, Field } from "./shared";

const partePapelSort = (a: string, b: string) => {
  const ka = parteSortKey(a), kb = parteSortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1];
};

// -------- Partes step (buffered) --------
// Compradores e vendedores são em número livre — o corretor adiciona quantos precisar, um bloco
// (nested Wizard) por pessoa, e só o "_1" de cada lado é obrigatório/fixo.
export function PartiesStep({ saleId, parties, banks, editable, onSaved, registerSaver, onDirtyChange }: {
  saleId: string; parties: Record<string, any>; banks: Record<string, any>; editable: boolean; onSaved: () => void;
  registerSaver: (fn: Saver | null) => void; onDirtyChange: (d: boolean) => void;
}) {
  const { user } = useAuth();
  const [papeis, setPapeis] = useState<string[]>(() => {
    const fromDb = Object.keys(parties).filter((p) => /^(vendedor|comprador)_\d+$/.test(p));
    return Array.from(new Set(["vendedor_1", "comprador_1", ...fromDb])).sort(partePapelSort);
  });
  const [forms, setForms] = useState<Record<string, any>>(() => {
    const m: Record<string, any> = {};
    papeis.forEach(p => { m[p] = parties[p] ?? {}; });
    return m;
  });
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const anyDirty = useMemo(() => Object.values(dirty).some(Boolean), [dirty]);
  const [saving, setSaving] = useState(false);

  // Conta bancária de cada vendedor/proprietário — mesmo esquema buffered/dirty/autosave das
  // partes, só que guardado à parte (tabela sale_bank_accounts, uma linha por parte "vendedor_N").
  const [bankForms, setBankForms] = useState<Record<string, any>>(() => {
    const m: Record<string, any> = {};
    papeis.forEach(p => { if (p.startsWith("vendedor_")) m[p] = banks[p] ?? {}; });
    return m;
  });
  const [bankDirty, setBankDirty] = useState<Record<string, boolean>>({});
  const anyBankDirty = useMemo(() => Object.values(bankDirty).some(Boolean), [bankDirty]);

  useEffect(() => {
    setBankForms((prev) => {
      const m: Record<string, any> = { ...prev };
      for (const p of papeis) {
        if (!p.startsWith("vendedor_")) continue;
        m[p] = bankDirty[p] ? prev[p] : (banks[p] ?? prev[p] ?? {});
      }
      return m;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banks]);

  const updBank = (papel: string, k: string, v: string) => {
    setBankForms(f => ({ ...f, [papel]: { ...f[papel], [k]: v } }));
    setBankDirty(d => ({ ...d, [papel]: true }));
  };

  // "Usar mesma conta de": copia banco/agência/conta/pix de outro vendedor já preenchido nesta
  // venda — não fica "linkado", só copia o valor atual (mesmo padrão de "puxar dado" já usado em
  // outras etapas, ex. PaymentStep.pullTitular).
  const copiarContaDe = (papel: string, deOutroPapel: string) => {
    const origem = bankForms[deOutroPapel];
    if (!origem) return;
    setBankForms(f => ({ ...f, [papel]: { ...f[papel], banco: origem.banco ?? null, agencia: origem.agencia ?? null, conta: origem.conta ?? null, pix: origem.pix ?? null } }));
    setBankDirty(d => ({ ...d, [papel]: true }));
  };

  // Não sincroniza por cima de uma parte com edição local não salva: "parties" chega com objeto
  // novo a cada load() do pai, disparado por ações sem relação com esta aba (upload de contrato,
  // troca de status, etc.) — sem preservar quem está dirty, isso apagava silenciosamente o que a
  // pessoa estava digitando e cancelava o autosave (dirty virava false no meio do delay).
  useEffect(() => {
    setForms((prev) => {
      const m: Record<string, any> = {};
      for (const p of papeis) m[p] = dirty[p] ? prev[p] : (parties[p] ?? prev[p] ?? {});
      return m;
    });
    setDirty((prev) => {
      const next: Record<string, boolean> = {};
      for (const p of papeis) if (prev[p]) next[p] = true;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parties]);

  const anyDirtyTotal = anyDirty || anyBankDirty;
  useEffect(() => { onDirtyChange(anyDirtyTotal); }, [anyDirtyTotal, onDirtyChange]);

  // Se a parte já chega do banco com cliente_id (ex.: a IA leu um RG/CPF e já achou/ligou o cliente
  // direto no servidor, sem passar por aqui — ver applySaleExtractions), carrega o histórico mesmo
  // sem o corretor ter tocado no campo CPF. Sem isso, o aviso "cliente já cadastrado" nunca
  // apareceria pra parte preenchida via documento.
  useEffect(() => {
    for (const [papel, party] of Object.entries(parties)) {
      if (party?.cliente_id && clienteMatch[papel] === undefined) {
        supabase.rpc("cliente_historico", { _cliente_id: party.cliente_id, _excluir_sale_id: saleId }).then(({ data: historico }) => {
          setClienteMatch((m) => ({ ...m, [papel]: { historico: historico ?? [] } }));
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parties]);

  const update = (papel: string, k: string, v: string) => {
    setForms(f => ({ ...f, [papel]: { ...f[papel], [k]: v } }));
    setDirty(d => ({ ...d, [papel]: true }));
  };

  // Reconhecimento de cliente: ao sair do campo CPF/CNPJ, busca se já existe alguém cadastrado
  // com esse documento (em qualquer venda, de qualquer equipe — clientes é visível pra empresa
  // toda) e pré-preenche os campos vazios, sem sobrescrever o que já foi digitado. Evita redigitar
  // dado de gente que já negociou com a imobiliária antes.
  const [clienteMatch, setClienteMatch] = useState<Record<string, { historico: { sale_id: string; papel: string; imovel_endereco: string | null; imovel_id: string | null; data: string }[] } | null>>({});

  const buscarCliente = async (papel: string, cpfDigitado: string | null | undefined) => {
    const normalizado = (cpfDigitado ?? "").replace(/\D/g, "");
    if (normalizado.length < 11) { setClienteMatch((m) => ({ ...m, [papel]: null })); return; }
    const { data: cliente } = await supabase.from("clientes").select("*").eq("cpf_cnpj_normalizado", normalizado).maybeSingle();
    if (!cliente) { setClienteMatch((m) => ({ ...m, [papel]: null })); return; }
    setForms((f) => ({
      ...f,
      [papel]: {
        ...f[papel],
        nome: f[papel].nome || cliente.nome,
        rg: f[papel].rg || cliente.rg,
        profissao: f[papel].profissao || cliente.profissao,
        email: f[papel].email || cliente.email,
        telefone: f[papel].telefone || cliente.telefone,
        endereco: f[papel].endereco || cliente.endereco,
        tipo_pessoa: cliente.tipo_pessoa ?? f[papel].tipo_pessoa,
        razao_social: f[papel].razao_social || cliente.razao_social,
        cnpj: f[papel].cnpj || cliente.cnpj,
      },
    }));
    setDirty((d) => ({ ...d, [papel]: true }));
    const { data: historico } = await supabase.rpc("cliente_historico", { _cliente_id: cliente.id, _excluir_sale_id: saleId });
    setClienteMatch((m) => ({ ...m, [papel]: { historico: historico ?? [] } }));
  };

  const [activePapel, setActivePapel] = useState(papeis[0]);

  const addPapel = (tipo: "vendedor" | "comprador") => {
    const nums = papeis.filter((p) => p.startsWith(`${tipo}_`)).map((p) => Number(p.split("_")[1]));
    const novoPapel = `${tipo}_${(nums.length ? Math.max(...nums) : 0) + 1}`;
    setPapeis((prev) => [...prev, novoPapel].sort(partePapelSort));
    setForms((f) => ({ ...f, [novoPapel]: {} }));
    if (tipo === "vendedor") setBankForms((f) => ({ ...f, [novoPapel]: {} }));
    setActivePapel(novoPapel);
  };

  const removePapel = async (papel: string) => {
    const existing = parties[papel];
    if (existing?.id) {
      const { error } = await supabase.from("sale_parties").delete().eq("id", existing.id);
      if (error) { toast.error(error.message); return; }
    }
    const existingBank = banks[papel];
    if (existingBank?.id) {
      const { error } = await supabase.from("sale_bank_accounts").delete().eq("id", existingBank.id);
      if (error) { toast.error(error.message); return; }
    }
    const idx = papeis.indexOf(papel);
    setPapeis((prev) => prev.filter((p) => p !== papel));
    setForms((f) => { const n = { ...f }; delete n[papel]; return n; });
    setDirty((d) => { const n = { ...d }; delete n[papel]; return n; });
    setBankForms((f) => { const n = { ...f }; delete n[papel]; return n; });
    setBankDirty((d) => { const n = { ...d }; delete n[papel]; return n; });
    if (activePapel === papel) setActivePapel(papeis[idx - 1] ?? papeis[idx + 1] ?? papeis[0]);
    toast.success("Removido");
    onSaved();
  };

  const saveAll = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      for (const papel of papeis) {
        if (!dirty[papel]) continue;
        const existing = parties[papel];
        const clientePayload = {
          tipo_pessoa: forms[papel].tipo_pessoa ?? "fisica", nome: forms[papel].nome ?? null,
          razao_social: forms[papel].razao_social ?? null, cnpj: forms[papel].cnpj ?? null,
          cpf_cnpj: forms[papel].cpf_cnpj ?? null, rg: forms[papel].rg ?? null,
          profissao: forms[papel].profissao ?? null, email: forms[papel].email ?? null,
          telefone: forms[papel].telefone ?? null, endereco: forms[papel].endereco ?? null,
        };
        // Cadastro de cliente centralizado (empresa toda): acha por CPF/CNPJ normalizado — se já
        // existe, atualiza com o que foi digitado agora; se não, cria. Ligado via sale_parties.cliente_id.
        const normalizado = (forms[papel].cpf_cnpj ?? "").replace(/\D/g, "");
        let clienteId: string | null = existing?.cliente_id ?? null;
        if (normalizado.length >= 11) {
          if (!clienteId) {
            const { data: achou } = await supabase.from("clientes").select("id").eq("cpf_cnpj_normalizado", normalizado).maybeSingle();
            clienteId = achou?.id ?? null;
          }
          if (clienteId) {
            const { error: clienteError } = await supabase.from("clientes").update({ ...clientePayload, updated_by: user?.id ?? null }).eq("id", clienteId);
            if (clienteError) { toast.error(clienteError.message); return false; }
          } else {
            const { data: novoCliente, error: clienteError } = await supabase.from("clientes").insert({ ...clientePayload, created_by: user?.id ?? null }).select("id").single();
            if (clienteError) {
              // Corrida: outro save concorrente (autosave x troca de aba/status, que também força
              // salvar) pode inserir o mesmo CPF entre o SELECT acima e este INSERT — o SELECT não
              // é atômico com o INSERT. Em vez de estourar erro pro usuário, busca de novo (a outra
              // chamada já deve ter criado) e atualiza esse registro em vez de falhar.
              if (clienteError.code === "23505") {
                const { data: achouDeNovo } = await supabase.from("clientes").select("id").eq("cpf_cnpj_normalizado", normalizado).maybeSingle();
                if (achouDeNovo) {
                  clienteId = achouDeNovo.id;
                  const { error: updateError } = await supabase.from("clientes").update({ ...clientePayload, updated_by: user?.id ?? null }).eq("id", clienteId);
                  if (updateError) { toast.error(updateError.message); return false; }
                } else {
                  toast.error(clienteError.message);
                  return false;
                }
              } else {
                toast.error(clienteError.message);
                return false;
              }
            } else {
              clienteId = novoCliente.id;
            }
          }
        }
        const data = {
          nome: forms[papel].nome ?? null, rg: forms[papel].rg ?? null, cpf_cnpj: forms[papel].cpf_cnpj ?? null,
          profissao: forms[papel].profissao ?? null, email: forms[papel].email ?? null, telefone: forms[papel].telefone ?? null,
          endereco: forms[papel].endereco ?? null, regime_casamento: forms[papel].regime_casamento ?? null,
          tipo_pessoa: forms[papel].tipo_pessoa ?? "fisica", razao_social: forms[papel].razao_social ?? null,
          cnpj: forms[papel].cnpj ?? null, cliente_id: clienteId,
        };
        const { error } = existing
          ? await supabase.from("sale_parties").update(data).eq("id", existing.id)
          : await supabase.from("sale_parties").insert({ sale_id: saleId, papel, ...data });
        if (error) { toast.error(error.message); return false; }
      }
      for (const papel of papeis) {
        if (!papel.startsWith("vendedor_") || !bankDirty[papel]) continue;
        const existingBank = banks[papel];
        // Titular vem do próprio nome já cadastrado acima — não é campo redigitado à parte.
        const bankData = {
          titular: forms[papel]?.nome ?? null,
          banco: bankForms[papel]?.banco ?? null,
          agencia: bankForms[papel]?.agencia ?? null,
          conta: bankForms[papel]?.conta ?? null,
          pix: bankForms[papel]?.pix ?? null,
        };
        const { error } = existingBank
          ? await supabase.from("sale_bank_accounts").update(bankData).eq("id", existingBank.id)
          : await supabase.from("sale_bank_accounts").insert({ sale_id: saleId, parte: papel, ...bankData });
        if (error) { toast.error(error.message); return false; }
      }
      setDirty({});
      setBankDirty({});
      onSaved();
      return true;
    } finally {
      setSaving(false);
    }
  }, [dirty, forms, papeis, parties, saleId, onSaved, bankDirty, bankForms, banks]);

  useEffect(() => { registerSaver(saveAll); return () => registerSaver(null); }, [saveAll, registerSaver]);
  useAutosave(editable && anyDirtyTotal, [forms, dirty, bankForms, bankDirty], saveAll);

  return (
    <div className="space-y-4">
      {editable && <AutosaveStatus saving={saving} dirty={anyDirtyTotal} />}
      <Wizard
        steps={papeis.map((p, i) => {
          const numero = Number(p.split("_")[1]);
          const outrosVendedoresComConta = papeis.filter((op) =>
            op.startsWith("vendedor_") && op !== p && (bankForms[op]?.banco || bankForms[op]?.conta || bankForms[op]?.pix),
          );
          return {
          key: p,
          label: parteLabel(p),
          content: (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{parteLabel(p)}</CardTitle>
            {editable && numero > 1 && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => removePapel(p)}>Remover</Button>
            )}
          </CardHeader>
          <CardContent>
            <FieldGrid>
              <Field label="Tipo de pessoa">
                <Select value={forms[p].tipo_pessoa ?? "fisica"} onValueChange={(v) => update(p, "tipo_pessoa", v)} disabled={!editable}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fisica">Pessoa física</SelectItem>
                    <SelectItem value="juridica">Pessoa jurídica</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Nome"><Input value={forms[p].nome ?? ""} onChange={(e) => update(p, "nome", e.target.value)} disabled={!editable} /></Field>
              {/* Jurídica soma aos campos de física (abaixo), não troca — quem assina pela empresa
                  continua sendo uma pessoa física, então ainda precisa de RG/CPF/Profissão dela. */}
              {(forms[p].tipo_pessoa ?? "fisica") === "juridica" && (
                <>
                  <Field label="Razão social"><Input value={forms[p].razao_social ?? ""} onChange={(e) => update(p, "razao_social", e.target.value)} disabled={!editable} /></Field>
                  <Field label="CNPJ"><Input value={forms[p].cnpj ?? ""} onChange={(e) => update(p, "cnpj", e.target.value)} disabled={!editable} /></Field>
                </>
              )}
              <Field label="RG"><Input value={forms[p].rg ?? ""} onChange={(e) => update(p, "rg", e.target.value)} disabled={!editable} /></Field>
              <Field label="CPF">
                <Input
                  value={forms[p].cpf_cnpj ?? ""}
                  onChange={(e) => update(p, "cpf_cnpj", e.target.value)}
                  onBlur={(e) => editable && buscarCliente(p, e.target.value)}
                  disabled={!editable}
                />
              </Field>
              {clienteMatch[p] && (
                <div className="md:col-span-2 flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
                  <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium text-emerald-800 dark:text-emerald-300">Cliente já cadastrado — dados preenchidos automaticamente</div>
                    {clienteMatch[p]!.historico.length > 0 ? (
                      <div className="mt-1.5 space-y-1">
                        {clienteMatch[p]!.historico.map((h) => (
                          <div key={h.sale_id} className="flex items-center justify-between gap-2 rounded border border-emerald-200 bg-background px-2 py-1 text-xs dark:border-emerald-900">
                            <span className="font-medium">{h.papel.startsWith("comprador") ? "Comprou" : "Vendeu"}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{h.imovel_endereco || h.imovel_id || "Imóvel sem endereço cadastrado"}</span>
                            <span className="shrink-0 text-muted-foreground">{new Date(h.data).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-muted-foreground">Primeira vez que esse CPF aparece numa venda. Edite os campos abaixo se algo mudou.</div>
                    )}
                  </div>
                </div>
              )}
              <Field label="Profissão"><Input value={forms[p].profissao ?? ""} onChange={(e) => update(p, "profissao", e.target.value)} disabled={!editable} /></Field>
              <Field label="E-mail"><Input type="email" value={forms[p].email ?? ""} onChange={(e) => update(p, "email", e.target.value)} disabled={!editable} /></Field>
              <Field label="Telefone"><Input value={forms[p].telefone ?? ""} onChange={(e) => update(p, "telefone", e.target.value)} disabled={!editable} /></Field>
              <Field label="Endereço" colSpan={2}><Input value={forms[p].endereco ?? ""} onChange={(e) => update(p, "endereco", e.target.value)} disabled={!editable} /></Field>
              <Field label="Regime de casamento"><Input value={forms[p].regime_casamento ?? ""} onChange={(e) => update(p, "regime_casamento", e.target.value)} placeholder="Ex.: Comunhão parcial de bens" disabled={!editable} /></Field>
            </FieldGrid>
          </CardContent>
          {p.startsWith("vendedor_") && (
            <CardContent className="border-t pt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">Dados bancários</div>
                {editable && outrosVendedoresComConta.length > 0 && (
                  <Select value="" onValueChange={(v) => copiarContaDe(p, v)}>
                    <SelectTrigger className="w-64"><SelectValue placeholder="Usar mesma conta de..." /></SelectTrigger>
                    <SelectContent>
                      {outrosVendedoresComConta.map((op) => <SelectItem key={op} value={op}>{parteLabel(op)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <FieldGrid>
                <Field label="Banco"><Input value={bankForms[p]?.banco ?? ""} onChange={(e) => updBank(p, "banco", e.target.value)} disabled={!editable} /></Field>
                <Field label="Agência"><Input value={bankForms[p]?.agencia ?? ""} onChange={(e) => updBank(p, "agencia", e.target.value)} disabled={!editable} /></Field>
                <Field label="Conta"><Input value={bankForms[p]?.conta ?? ""} onChange={(e) => updBank(p, "conta", e.target.value)} disabled={!editable} /></Field>
                <Field label="PIX"><Input value={bankForms[p]?.pix ?? ""} onChange={(e) => updBank(p, "pix", e.target.value)} disabled={!editable} /></Field>
              </FieldGrid>
            </CardContent>
          )}
          <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-0">
            <div className="flex gap-2">
              {editable && (
                <>
                  <Button size="sm" variant="outline" onClick={() => addPapel("comprador")}>+ Adicionar comprador</Button>
                  <Button size="sm" variant="outline" onClick={() => addPapel("vendedor")}>+ Adicionar vendedor/proprietário</Button>
                </>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {i > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setActivePapel(papeis[i - 1])}>
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Voltar
                </Button>
              )}
              {i < papeis.length - 1 && (
                <Button size="sm" variant="ghost" onClick={() => setActivePapel(papeis[i + 1])}>
                  Próximo bloco <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
          ),
        };})}
        current={activePapel}
        onChange={setActivePapel}
        hideNav
      />
    </div>
  );
}
