import { COMISSAO_PAPEIS, PARCERIA_TIPOS } from "@/lib/status";
import { money, dateBR } from "./shared";

function FormTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border border-b-0 border-foreground/30 bg-muted/60 px-3 py-1.5 text-xs font-bold uppercase tracking-wide">
      <span>{children}</span>
      {right && <span className="font-medium normal-case tracking-normal">{right}</span>}
    </div>
  );
}
function FormTable({ children }: { children: React.ReactNode }) {
  return (
    <table className="mb-4 w-full border-collapse border border-foreground/30 text-sm">
      <tbody>{children}</tbody>
    </table>
  );
}
function FormHeadRow({ cols }: { cols: string[] }) {
  return (
    <tr>
      {cols.map((c, i) => (
        <th key={i} className="border border-foreground/30 bg-muted/40 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {c}
        </th>
      ))}
    </tr>
  );
}
function FormValueRow({ cols }: { cols: React.ReactNode[] }) {
  return (
    <tr>
      {cols.map((c, i) => (
        <td key={i} className="border border-foreground/30 px-2 py-1.5 align-top">
          {c ?? <span className="text-muted-foreground">—</span>}
        </td>
      ))}
    </tr>
  );
}
function Checkbox({ checked, label }: { checked: boolean; label: string }) {
  return <span className="font-mono">({checked ? "X" : " "}) {label}</span>;
}

/** Tabelas do formulário "Ocorrência de compra e venda", compartilhadas entre a revisão (pré-finalização) e o relatório final.
 * `papeis` deixa trocar a lista de papéis de comissão exibida (default COMISSAO_PAPEIS) — a venda de
 * Lançamento usa um subconjunto diferente (sem captador/vendedor/indicador, com Coordenador). */
export function OccurrenceReportBody({ sale, occ, commissions, partners, parties, distribuicao, papeis = COMISSAO_PAPEIS }: {
  sale: any; occ: any; commissions: any[]; partners: any[]; parties: Record<string, any>; distribuicao?: any; papeis?: typeof COMISSAO_PAPEIS;
}) {
  // Vendedor/comprador pessoa jurídica (ex: construtora do Lançamento) só preenche razão social/CNPJ,
  // sem nome/CPF de representante — cai pro nome fantasia/CNPJ pra não mostrar a linha em branco.
  const vendedores = Object.entries(parties).filter(([papel]) => papel.startsWith("vendedor"))
    .map(([, p]) => ({ ...p, nome: p.nome || p.razao_social, cpf_cnpj: p.cpf_cnpj || p.cnpj }));
  const compradores = Object.entries(parties).filter(([papel]) => papel.startsWith("comprador"))
    .map(([, p]) => ({ ...p, nome: p.nome || p.razao_social, cpf_cnpj: p.cpf_cnpj || p.cnpj }));
  // Todas as linhas daquele papel, não só a primeira — find() escondia um segundo captador/vendedor,
  // mais de um gestor/Team Leader, ou outros extras repetidos do mesmo papel.
  const commByPapel = (papel: string) => commissions.filter((c) => c.papel === papel);

  // Valor da comissão total é bruto (inclui a parte da parceria externa, quando houver) — a linha
  // extra abaixo mostra só o que fica pra nossa imobiliária, descontada essa fatia.
  const somaParceria = partners.reduce((s, p) => s + Number(p.valor ?? 0), 0);
  const totalComissao = Number(occ?.valor_comissao ?? sale.valor_total_comissao ?? 0);
  const valorNosso = totalComissao - somaParceria;
  // Imobiliária = o que sobra depois de pagar todo mundo listado na tabela abaixo (captador,
  // vendedor, indicador, líder de cada lado, gestor/team leader antigo, outro) — soma TODAS as
  // linhas de commissions, não só a primeira de cada papel (pode haver mais de um "Outro" extra).
  const somaComissoes = commissions.reduce((s, c) => s + Number(c.valor ?? 0), 0);
  // Fonte única: calcular_distribuicao_venda() (mesma RPC usada no Resumo/Ocorrência/ranking) —
  // nunca recalcula aqui. Só cai no cálculo local (base REMAX/legado menos soma das comissões) se o
  // componente for usado sem o prop distribuicao (compatibilidade com chamadas antigas).
  const valorImobiliaria = distribuicao?.saldo_liquido_imobiliaria ?? (() => {
    const baseImobiliaria = sale.percentual_remax != null ? Number(sale.valor_remax ?? 0) : valorNosso;
    return baseImobiliaria - somaComissoes;
  })();

  return (
    <>
      <div className="mb-3 border border-foreground/30 bg-foreground/5 py-2 text-center text-base font-bold uppercase tracking-wide">
        Ocorrência de compra e venda
      </div>

      <FormTable>
        <FormHeadRow cols={["Código do imóvel", "Tempo de venda", "Data de assinatura", "Nota fiscal obrigatória", "Mídia"]} />
        <FormValueRow cols={[
          sale.imovel_id || sale.codigo_interno,
          occ?.tempo_venda_dias != null ? `${occ.tempo_venda_dias} dias` : "",
          <span className="font-semibold">{dateBR(occ?.data_assinatura)}</span>,
          <Checkbox checked={!!occ?.nota_fiscal_obrigatoria} label={occ?.nota_fiscal_obrigatoria ? "Sim" : "Não"} />,
          occ?.midia,
        ]} />
      </FormTable>

      {vendedores.map((v: any, i: number) => (
        <FormTable key={v.id ?? i}>
          <FormValueRow cols={[<span><b>Nome do vendedor/proprietário:</b> {v.nome}</span>, <span><b>E-mail:</b> {v.email}</span>]} />
          <FormValueRow cols={[<span><b>CPF/CNPJ:</b> {v.cpf_cnpj}</span>, <span><b>RG:</b> {v.rg}</span>, <span><b>Celular:</b> {v.telefone}</span>]} />
          <FormValueRow cols={[<span><b>Endereço:</b> {v.endereco}</span>]} />
        </FormTable>
      ))}
      {compradores.map((c: any, i: number) => (
        <FormTable key={c.id ?? i}>
          <FormValueRow cols={[<span><b>Nome do comprador:</b> {c.nome}</span>, <span><b>E-mail:</b> {c.email}</span>]} />
          <FormValueRow cols={[<span><b>CPF/CNPJ:</b> {c.cpf_cnpj}</span>, <span><b>RG:</b> {c.rg}</span>, <span><b>Celular:</b> {c.telefone}</span>]} />
          <FormValueRow cols={[<span><b>Endereço:</b> {c.endereco}</span>]} />
        </FormTable>
      ))}

      <FormTitle>Resumo da transação</FormTitle>
      <FormTable>
        <FormHeadRow cols={["Valor anunciado", "Valor negociado", "Percentual", "Valor da comissão"]} />
        <FormValueRow cols={[
          money(occ?.valor_anunciado ?? sale.valor_anunciado),
          money(occ?.valor_negociado ?? sale.valor_negociado),
          occ?.percentual_comissao ?? sale.percentual_comissao ? `${occ?.percentual_comissao ?? sale.percentual_comissao}%` : null,
          <span className="text-base font-bold text-primary">{money(occ?.valor_comissao ?? sale.valor_total_comissao)}</span>,
        ]} />
        {somaParceria > 0 && (
          <FormValueRow cols={[
            null, null,
            <span className="text-muted-foreground">Nossa parte (desconta parceria)</span>,
            <span className="text-base font-bold text-emerald-700 dark:text-emerald-400">{money(valorNosso)}</span>,
          ]} />
        )}
        {/* Prêmio/bônus da venda de Lançamento — somado à comissão só na previsão de recebimento
            (occurrences.premio_valor, "fora da conta percentual normal"), nunca faz parte de "Valor
            da comissão" acima. Sem esta linha, a previsão de recebimento aparecia maior que a
            comissão sem nenhuma explicação visível no relatório. */}
        {!!occ?.premio_valor && (
          <FormValueRow cols={[
            null, null,
            <span className="text-muted-foreground">Prêmio (Lançamento)</span>,
            <span className="text-base font-bold">{money(occ.premio_valor)}</span>,
          ]} />
        )}
      </FormTable>

      <FormTable>
        <FormHeadRow cols={["Papel", "Nome", "Comissão %", "Comissão R$"]} />
        {papeis.flatMap((p) => {
          const rows = commByPapel(p.key);
          if (rows.length === 0) {
            return [<FormValueRow key={p.key} cols={[p.label, "Não possui", "0%", "R$ 0,00"]} />];
          }
          // Papel só aparece na 1ª linha do grupo — evita repetir "Outro" quatro vezes seguidas
          // quando há mais de um extra do mesmo papel, mas nenhum participante fica escondido.
          return rows.map((c, i) => (
            <FormValueRow key={c.id ?? `${p.key}-${i}`} cols={[i === 0 ? p.label : "", c.nome ?? "Não possui", c.percentual != null ? `${c.percentual}%` : "0%", money(c.valor) ?? "R$ 0,00"]} />
          ));
        })}
        {sale.percentual_remax != null && (
          <FormValueRow cols={["REMAX", "—", `${sale.percentual_remax}%`, money(sale.valor_remax) ?? "R$ 0,00"]} />
        )}
        <FormValueRow cols={[<b>Imobiliária</b>, "—", "—", <b>{money(valorImobiliaria) ?? "R$ 0,00"}</b>]} />
      </FormTable>

      <FormTitle right={<Checkbox checked={!!occ?.financiamento} label={occ?.financiamento ? "Sim" : "Não"} />}>
        Dados de financiamento — financiamento
      </FormTitle>
      <FormTable>
        <FormHeadRow cols={["Financiamento R$", "Banco", "Correspondente bancário", "Previsão da liberação do crédito", "Oba Crédito"]} />
        <FormValueRow cols={[money(occ?.financiamento_valor), occ?.financiamento_banco, occ?.financiamento_correspondente, dateBR(occ?.financiamento_previsao), occ?.oba_credito ? "Sim" : "Não"]} />
      </FormTable>

      <FormTitle>Previsão de recebimento da comissão</FormTitle>
      <FormTable>
        <FormHeadRow cols={["1ª parcela", "Data", "Forma de pagamento"]} />
        <FormValueRow cols={[money(occ?.prev_recebimento_valor), dateBR(occ?.prev_recebimento_data), occ?.prev_recebimento_forma]} />
        <FormHeadRow cols={["2ª parcela", "Data", "Forma de pagamento"]} />
        <FormValueRow cols={[money(occ?.prev_recebimento2_valor), dateBR(occ?.prev_recebimento2_data), occ?.prev_recebimento2_forma]} />
        <FormHeadRow cols={["3ª parcela", "Data", "Forma de pagamento"]} />
        <FormValueRow cols={[money(occ?.prev_recebimento3_valor), dateBR(occ?.prev_recebimento3_data), occ?.prev_recebimento3_forma]} />
      </FormTable>

      <FormTitle>Parceria</FormTitle>
      <FormTable>
        <FormHeadRow cols={["Tipo", "Corretor(a) / Imobiliária", "CPF/CNPJ", "Percentual", "Valor da comissão"]} />
        {partners.length === 0 && <FormValueRow cols={["Não possui", null, null, "0%", "R$ 0,00"]} />}
        {partners.map((p) => (
          <FormValueRow key={p.id} cols={[PARCERIA_TIPOS.find((t) => t.key === p.tipo)?.label ?? "—", p.nome, p.cpf_cnpj, p.percentual != null ? `${p.percentual}%` : "0%", money(p.valor) ?? "R$ 0,00"]} />
        ))}
        <FormHeadRow cols={["", "Dados bancários", "Banco", "Agência", "Conta"]} />
        {partners.length === 0 && <FormValueRow cols={[null, null, null, null, null]} />}
        {partners.map((p) => (
          <FormValueRow key={`${p.id}-bank`} cols={[null, null, p.banco, p.agencia, p.conta]} />
        ))}
      </FormTable>

      {occ?.observacoes && (
        <FormTable>
          <FormHeadRow cols={["Observações"]} />
          <FormValueRow cols={[occ.observacoes]} />
        </FormTable>
      )}
    </>
  );
}
