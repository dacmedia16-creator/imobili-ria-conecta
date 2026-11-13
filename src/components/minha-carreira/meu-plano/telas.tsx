/**
 * Corpo de cada tela do Meu Plano 2027 (1 página de exercício do book = 1 tela). Portado da maquete v3
 * aprovada. Os campos gravam pelo contexto (PlanoCtx); as contas vêm de regras.ts (testadas).
 */
import type { ReactNode } from "react";
import {
  AFIRMACOES,
  AGENDA,
  CANAIS,
  CLUBES,
  DIAS,
  FAIXAS,
  NEGOCIO,
  ORIGENS,
  PESSOAL,
  PORQUE,
  REGUA,
  addDias,
  cheio,
  dataBR,
  fmt,
  nomeDia,
  num,
  ok,
  soma,
  type Calc,
} from "@/lib/meu-plano-2027/regras";
import { KRIS, ORDEM, P15_CAMPOS, rotuloPagina, tela } from "@/lib/meu-plano-2027/telas";
import {
  chaveMes,
  chavesTabela,
  tabelasMes,
  type IdLinhaDigita,
  type IdTabelaMes,
  type LinhaMes,
} from "@/lib/meu-plano-2027/meses";
import {
  BLOCOS_SEMANA,
  MARCOS_CAPT,
  MARCOS_VENDA,
  MESES,
  SEMANAS,
} from "@/lib/meu-plano-2027/listas";
import { Pill } from "@/components/visual/base";
import { cn } from "@/lib/utils";
import {
  Aviso,
  Bloco,
  Campo,
  Check,
  Citacao,
  Conta,
  Dica,
  Inp,
  Linha,
  Nota,
  Radio,
  Selecao,
  Stat,
  usePlanoCtx,
} from "./campos";

const SELO: Record<"tem" | "parc" | "nao", [string, "green" | "amber" | "red"]> = {
  tem: ["✔ o ADM MAX traz", "green"],
  parc: ["◐ você confere", "amber"],
  nao: ["✖ você digita", "red"],
};

/** Pontos de encaixe preenchidos pela página (ações que gravam fora das respostas). */
export type Extras = {
  p15?: ReactNode; // "Trazer meus números do ADM MAX"
  p32?: ReactNode; // "Usar como minha meta oficial de 2027"
  p45?: ReactNode; // assinaturas do pacto
  irPara?: (id: string) => void;
};

/** "pág. N · PDF M" de uma tela, clicável quando dá para ir até ela (item 11: de onde vem cada número). */
function Origem({ id, irPara }: { id: string; irPara?: (id: string) => void }) {
  const p = tela(id);
  if (!p) return null;
  const txt = `${p.t} (${rotuloPagina(p.pdf)})`;
  return irPara ? (
    <button type="button" className="font-semibold underline" onClick={() => irPara(id)}>
      {txt}
    </button>
  ) : (
    <b>{txt}</b>
  );
}

/** Subtítulo numerado dentro de um bloco (ex.: "01 · Região"), com a bolinha "como preencher". */
function Sub({
  children,
  ajuda,
}: {
  children: ReactNode;
  ajuda: Parameters<typeof Dica>[0]["id"];
}) {
  return (
    <div className="relative mt-3 flex items-center gap-1.5 first:mt-1">
      <h4 className="text-sm font-semibold text-primary">{children}</h4>
      <Dica id={ajuda} />
    </div>
  );
}

export function CorpoTela({ id, extras }: { id: string; extras?: Extras }) {
  const { S, C, inicio, ro } = usePlanoCtx();
  switch (id) {
    case "p15":
      return (
        <>
          {extras?.p15}
          <Bloco ajuda="p15.indicadores">
            {P15_CAMPOS.map(([k, l, t, s]) => (
              <div
                key={k}
                className="grid grid-cols-[1fr_7.5rem] items-center gap-2 border-b border-dashed py-2 last:border-0"
              >
                <div className="min-w-0 text-sm">
                  {l}
                  <div className="mt-0.5">
                    <Pill tom={SELO[s][1]}>{SELO[s][0]}</Pill>
                  </div>
                </div>
                <Inp k={k} tipo={t} label={l} />
              </div>
            ))}
          </Bloco>
          <p className="text-xs text-muted-foreground" data-testid="p15-sem-historico">
            Começando agora e ainda sem histórico? Digite 0 no que não tiver. O ticket médio e a
            conversão daqui entram nas contas de “Da comissão à transação” e “Da transação à
            captação”; com 0, essas telas pedem o seu valor.
          </p>
          <p className="text-xs text-muted-foreground">
            *Transação é cada lado de um negócio: captar o imóvel vendido = 1 transação de captação;
            trazer o comprador = 1 transação de venda. Os dois lados = 2 transações.
          </p>
          <Aviso>
            Olhe para os 2 últimos indicadores: são os que quase ninguém acompanha e os que mais
            explicam o resultado do ano que vem.
          </Aviso>
        </>
      );
    case "p16":
      return (
        <>
          <Bloco ajuda="p16.origens">
            <div className="grid grid-cols-[1fr_3.5rem_3.5rem] gap-1.5 border-b pb-1 text-[11px] font-semibold text-muted-foreground">
              <span>Origem</span>
              <span>Captações vendidas</span>
              <span>Clientes compradores</span>
            </div>
            {ORIGENS.map((o, i) => (
              <div
                key={o}
                className="grid grid-cols-[1fr_3.5rem_3.5rem] items-center gap-1.5 border-b border-dashed py-1.5 text-[13px] last:border-0"
              >
                <span>{o}</span>
                <Inp
                  k={`or.${i}.c`}
                  tipo="int"
                  ph=""
                  label={`${o}: captações`}
                  className="px-1 text-center"
                />
                <Inp
                  k={`or.${i}.v`}
                  tipo="int"
                  ph=""
                  label={`${o}: compradores`}
                  className="px-1 text-center"
                />
              </div>
            ))}
          </Bloco>
          <Bloco titulo="Minhas 3 maiores origens do ano (automático)" ajuda="p16.top3">
            {C.top3.length ? (
              <ol className="list-decimal pl-5 text-sm font-semibold">
                {C.top3.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ol>
            ) : (
              <Aviso>
                Ainda vazio: as 3 maiores origens aparecem aqui sozinhas quando você anotar, na
                tabela acima, quantos negócios vieram de cada origem. O ADM MAX ainda não traz as
                origens.
              </Aviso>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Essas três recebem o seu investimento em 2027 (voltam na tela de marketing).
            </p>
          </Bloco>
        </>
      );
    case "p17":
      return (
        <Bloco ajuda="p17.notas">
          {AFIRMACOES.map((a, i) => (
            <Nota key={i} k={`av.${i}`} rot={`${i + 1}. ${a[0]}`} />
          ))}
          <Conta rot="Total (6 a 30)" v={C.notaTotal} f="int" main />
          {C.notaFaixa ? (
            <>
              <Aviso tom="green">
                <b>{C.notaFaixa}</b>
              </Aviso>
              {C.notaTotal > 12 ? (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {C.armadilhas.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Responda as 6 para ver o resultado.
            </p>
          )}
        </Bloco>
      );
    case "p20":
      return (
        <>
          <Bloco ajuda="p20.perguntas">
            {PORQUE.map((q, i) => (
              <Campo key={i} k={`pq.${i}`} label={`${i + 1}. ${q[0]}`} tipo="area" hint={q[1]} />
            ))}
          </Bloco>
          <Bloco className="border-rose-900/40">
            <Pill tom="red">A FRASE QUE SUSTENTA O PLANO</Pill>
            <Campo
              k="pq.frase"
              label="Com base nas respostas, como você resumiria seu principal porquê em uma frase?"
              tipo="area"
              ajuda="p20.frase"
            />
          </Bloco>
        </>
      );
    case "p22":
      return (
        <>
          <Bloco ajuda="p22.orcamento">
            {PESSOAL.map((g, i) => (
              <Linha key={i} k={`op.${i}`} rot={g[0]} sub={g[1]} />
            ))}
            <Conta rot="Total mensal" v={C.pessoalMes} />
            <Conta rot="Total anual (× 12)" v={C.pessoalAno} main />
          </Bloco>
          <p className="text-xs text-muted-foreground">
            Este é o número que o seu negócio precisa sustentar antes de qualquer sonho.
          </p>
        </>
      );
    case "p23":
      return (
        <Bloco ajuda="p23.orcamento">
          {NEGOCIO.map((g, i) => (
            <Linha key={i} k={`on.${i}`} rot={g[0]} sub={g[1]} />
          ))}
          <Conta rot="Total mensal" v={C.negocioMes} />
          <Conta rot="Total anual (× 12)" v={C.negocioAno} main />
        </Bloco>
      );
    case "p24":
      return (
        <Bloco ajuda="p24.sonhos">
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <Campo k={`so.${i}.t`} label={`Sonho ${i + 1}`} ph="ex.: viagem em família" />
              <Campo k={`so.${i}.v`} label="Valor no ano" tipo="money" />
            </div>
          ))}
          <Conta rot="O custo dos meus sonhos" v={C.sonhos} main />
        </Bloco>
      );
    case "p25":
      return (
        <>
          <Bloco>
            <Conta rot="1 · Orçamento pessoal no ano" v={C.pessoalAno} />
            <Conta rot="2 · Orçamento do negócio no ano" v={C.negocioAno} />
            <Conta rot="3 · Meus sonhos no ano" v={C.sonhos} />
            <Conta rot="4 · Subtotal (1 + 2 + 3)" v={C.subtotal} />
            <Campo
              k="es.aliq"
              label="5 · Minha alíquota estimada de imposto (%)"
              tipo="pct"
              ph="ex.: 15"
              ajuda="p25.aliq"
              hint="Este plano não é orientação fiscal."
            />
            <Conta
              rot="6 · O NÚMERO DO MEU ESTILO DE VIDA · linha 4 ÷ (1 − linha 5)"
              v={C.estiloAno}
              main
            />
            <Conta rot="por mês" v={C.estiloMes} />
          </Bloco>
          <Citacao>
            Comissão recebida não é dinheiro no bolso. Quem planeja sem considerar o imposto planeja
            um ano que não fecha.
          </Citacao>
        </>
      );
    case "p27":
      return (
        <>
          <Bloco ajuda="p27.conta">
            <Conta rot="1 · O número do meu estilo de vida" v={C.estiloAno} />
            <Selecao
              k="m.faixa"
              label="2 · Minha faixa de comissionamento hoje"
              ajuda="p27.faixa"
              opcoes={FAIXAS.map((f) => [String(f[0]), f[1]])}
            />
            <Conta rot="3 · Comissão bruta que preciso gerar (1 ÷ 2)" v={C.bruta} />
            <Campo
              k="m.ticket"
              label="4 · Meu ticket médio (R$)"
              tipo="money"
              ajuda="p27.ticket"
              ph={C.d.ticket > 0 ? `do diagnóstico: ${fmt.brl0(C.d.ticket)}` : "ex.: 700.000"}
              hint={
                cheio(S["m.ticket"]) ? (
                  "Valor digitado por você."
                ) : C.d.ticket > 0 ? (
                  <>
                    Em branco: a conta está usando <b>{fmt.brl0(C.d.ticket)}</b> do seu diagnóstico,{" "}
                    <Origem id="p15" irPara={extras?.irPara} />. Digite aqui só se quiser outro
                    valor.
                  </>
                ) : (
                  <>
                    ⚠ Falta o ticket: preencha o “Ticket médio das transações vendidas” em{" "}
                    <Origem id="p15" irPara={extras?.irPara} /> ou digite aqui. Ainda sem histórico?
                    Use o preço médio dos imóveis da sua região.
                  </>
                )
              }
            />
            <Campo
              k="m.pct"
              label="5 · Percentual de comissão por transação (%)"
              tipo="pct"
              ajuda="p27.pct"
              ph="ex.: 3"
            />
            <Conta rot="6 · Comissão média por transação (4 × 5)" v={C.comTrans} />
            <Conta
              rot="7 · TRANSAÇÕES QUE PRECISO FECHAR EM 2027 (3 ÷ 6)"
              v={C.trans}
              f="int"
              main
            />
            {C.transAcima ? (
              <Aviso>
                ⚠ {fmt.int(C.trans)} transações é bem acima das {fmt.int(C.d.trans)} do ano passado.
                Escolha agora um dos três caminhos: <b>subir o ticket médio</b>,{" "}
                <b>subir a captação</b> ou <b>revisar o estilo de vida</b> (comece pelas despesas
                pessoais e sonhos; preserve o orçamento do negócio).
              </Aviso>
            ) : null}
          </Bloco>
          <Bloco titulo="Minha próxima faixa e meu clube" ajuda="p27.proxima">
            <Selecao
              k="m.faixaAlvo"
              label="Faixa que quero alcançar"
              opcoes={FAIXAS.map((f) => [String(f[0]), f[1]])}
            />
            <Selecao
              k="mt.clube"
              label="Clube de Corretores que quero conquistar em 2027"
              opcoes={CLUBES.map((c) => [c.n, c.n])}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              É a mesma resposta de “Minhas metas para 2027”: mudou aqui, muda lá.
              {C.clubeSug ? ` Pelo VGC do seu plano, a faixa é ${C.clubeSug.n}.` : ""}
            </p>
          </Bloco>
        </>
      );
    case "p30":
      return (
        <>
          <Bloco ajuda="p30.conta">
            <Conta rot="1 · Transações que preciso fechar" v={C.trans} f="int" />
            <Campo
              k="m.conv"
              label="2 · Minha conversão da captação (%)"
              tipo="pct"
              ajuda="p30.conv"
              ph={C.d.conv > 0 ? `do diagnóstico: ${C.d.conv}%` : "ex.: 22"}
              hint={
                cheio(S["m.conv"]) ? (
                  "Valor digitado por você."
                ) : C.d.conv > 0 ? (
                  <>
                    Em branco: a conta está usando <b>{fmt.dec(C.d.conv)}%</b> do seu diagnóstico,{" "}
                    <Origem id="p15" irPara={extras?.irPara} />. Digite aqui só se quiser outro
                    valor.
                  </>
                ) : (
                  <>
                    ⚠ As captações ficam em branco até ter a conversão: preencha a “Conversão das
                    CREs” em <Origem id="p15" irPara={extras?.irPara} /> ou digite aqui. Ainda sem
                    histórico? O exemplo do book usa 22%.
                  </>
                )
              }
            />
            <Conta
              rot="3 · CAPTAÇÕES QUE PRECISO FAZER EM 2027 (1 ÷ 2)"
              v={C.captAno}
              f="int"
              main
            />
            <Conta rot="4 · CAPTAÇÕES POR MÊS (3 ÷ 12)" v={C.captMes} f="int" main />
          </Bloco>
          <Citacao>
            Carteira só é real com preço correto, o resto é autoenganação. Não aceite captação só
            para aumentar a carteira.
          </Citacao>
        </>
      );
    case "p31":
      return (
        <>
          <Bloco>
            {/* Só registro, como a linha em branco do book (pág. 30): não entra em conta nem na meta oficial. */}
            <Campo
              k="m.carteira"
              label="Quantas CREs ativas quero manter ao longo de 2027"
              tipo="int"
              ajuda="p31.carteira"
              ph="ex.: 15"
              hint="Só para você registrar o número; não muda nenhuma conta do plano nem a meta oficial."
            />
          </Bloco>
          <Bloco titulo="Onde eu quero estar" ajuda="p31.alvo">
            <Radio
              k="m.alvo"
              opcoes={[
                "11 a 15 CREs ativas",
                "16 a 18 CREs ativas",
                "19 ou mais, com estrutura de apoio",
              ]}
            />
          </Bloco>
          <Bloco titulo="Confira a sua conta (automática)" ajuda="p31.conta">
            <Conta rot="Captações por mês" v={C.captMes} f="int" />
            <Campo
              k="m.meses"
              label="Meses que cada imóvel fica na sua carteira"
              tipo="int"
              ph={ok(C.d.dias) ? `do diagnóstico: ${fmt.dec(C.d.dias / 30)}` : "ex.: 4"}
            />
            <Conta rot="≈ CREs ativas (captações/mês × meses)" v={C.creEstimada} f="int" main />
            {ok(C.creEstimada) ? (
              <Aviso tom={C.creEstimada > 18 ? "amber" : "green"}>
                {C.creEstimada > 18 ? "⚠ " : ""}
                {fmt.int(C.creEstimada)} CREs ativas: <b>{C.creEstimadaRegua}</b>.
                {C.creEstimada > 18
                  ? " Passou de 18: o seu plano pede conversão maior, ticket maior ou estrutura de apoio, não só mais captação."
                  : ""}
              </Aviso>
            ) : null}
          </Bloco>
          <details className="rounded-xl border bg-card">
            <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold">
              A régua das CREs ativas ({rotuloPagina(31)})
            </summary>
            <table className="mx-3 mb-3 w-[calc(100%-1.5rem)] text-[13px]">
              <tbody>
                {REGUA.map((r) => (
                  <tr key={r[0]} className="border-b last:border-0">
                    <td className="py-1.5 pr-2 font-semibold">
                      {r[1] > 1e8 ? "mais de 23" : `${r[0]} a ${r[1]}`}
                    </td>
                    <td className="py-1.5">{r[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      );
    case "p32":
      return <TelaMetas extra={extras?.p32} irPara={extras?.irPara} />;
    case "p11":
      return <TelaKris irPara={extras?.irPara} />;
    case "p34":
      return (
        <>
          <Bloco>
            <Sub ajuda="p34.regiao">01 · Região</Sub>
            <Campo k="pos.regiao" label="Minha área de atuação" tipo="area" ph="bairros / região" />
            <div className="grid grid-cols-2 gap-2">
              <Campo k="pos.pctHoje" label="Carteira hoje na região (%)" tipo="pct" />
              <Campo k="pos.pctMeta" label="Meta no fim de 2027 (%)" tipo="pct" />
            </div>
            <Sub ajuda="p34.tipo">02 · Tipo de imóvel</Sub>
            <Campo k="pos.tipo" label="Tipo em que quero ser referência" />
            <Sub ajuda="p34.ticket">03 · Ticket médio</Sub>
            <div className="grid grid-cols-2 gap-2">
              <Campo k="pos.de" label="De R$" tipo="money" />
              <Campo k="pos.ate" label="a R$" tipo="money" />
            </div>
            <Campo
              k="pos.pctTipo"
              label="Quanto da carteira quero nesse tipo e faixa no fim de 2027 (%)"
              tipo="pct"
            />
          </Bloco>
          <div className="grid grid-cols-2 gap-2">
            <Stat v="+45%" rot="mais vendas no seu posicionamento" />
            <Stat v="25 dias" rot="mais rápido: 106 contra 131" />
          </div>
        </>
      );
    case "p36":
      return (
        <>
          <Bloco ajuda="p36.horas">
            {BLOCOS_SEMANA.map((b, i) => (
              <Linha key={i} k={`sp.${i}`} rot={b[0]} sub={b[1]} tipo="int" ph="h/sem" />
            ))}
            <Conta rot="TOTAL DE HORAS POR SEMANA" v={C.horasTot} f="int" main />
          </Bloco>
          <Bloco>
            <Selecao
              k="sp.dia"
              label="Meu dia de revisão de estoque é"
              opcoes={DIAS}
              ajuda="p36.dia"
            />
          </Bloco>
          <details className="rounded-xl border bg-card">
            <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold">
              A regra dos 4 pontos
            </summary>
            <div className="px-3 pb-3 text-[13px]">
              <p>
                Contato com agendamento 0,5 · Primeira visita (V1) 1 · CRE assinada 2 · Venda 4.
              </p>
              <p className="mt-1">
                Nenhum dia termina sem 4 pontos. O total da semana vai no acompanhamento semanal.
              </p>
            </div>
          </details>
        </>
      );
    case "p37":
      return (
        <>
          <Bloco>
            <Conta rot="CREs por mês (da tela de captação)" v={C.captMes} f="int" />
            <Campo
              k="fu.v2cre"
              label="De cada 100 segundas visitas (V2), quantas viram CRE? (%)"
              tipo="pct"
              ajuda="p37.v2cre"
              ph={`padrão: ${C.txV2Cre}`}
            />
            <Conta rot="Segundas visitas (V2) por mês" v={C.v2Mes} f="int" />
            <Campo
              k="fu.v1v2"
              label="De cada 100 primeiras visitas (V1), quantas viram V2? (%)"
              tipo="pct"
              ajuda="p37.v1v2"
              ph={`padrão: ${C.txV1V2}`}
            />
            <Conta rot="Primeiras visitas (V1) por mês" v={C.v1Mes} f="int" />
            <Campo
              k="fu.folga"
              label="Taxa de folga para quem desmarca (%)"
              tipo="pct"
              ph={`padrão: ${C.folga}`}
              ajuda="p37.folga"
            />
            <Conta
              rot="RESULTADO · CONTATOS COM AGENDAMENTO POR SEMANA"
              v={C.contSem}
              f="int"
              main
            />
            {ok(C.contSem) ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Conta: {fmt.int(C.v1Mes)} V1 por mês ÷ 4 semanas = {fmt.dec(C.v1Mes / 4)} +{" "}
                {fmt.dec(C.folga)}% de folga = {fmt.dec((C.v1Mes / 4) * (1 + C.folga / 100))},
                arredondado para cima = <b>{fmt.int(C.contSem)}</b>.
              </p>
            ) : null}
          </Bloco>
          <Aviso>
            Campo em branco usa a taxa padrão da imobiliária. Não sabe as suas taxas? Comece medindo
            agora, no CRM.
          </Aviso>
          <Bloco titulo="Minha lista FROG" ajuda="p37.frog">
            <div className="grid grid-cols-2 gap-2">
              <Campo k="fu.crmHoje" label="Pessoas no CRM hoje" tipo="int" />
              <Campo k="fu.crmFim" label="Quero ter no fim de 2027" tipo="int" />
            </div>
          </Bloco>
        </>
      );
    case "p38":
      return (
        <>
          <Bloco titulo="Meus compromissos" ajuda="p38.compromissos">
            <Campo
              k="rv.mes"
              label="Todo mês eu reviso o preço de pelo menos … imóveis"
              tipo="int"
            />
            <Campo k="rv.dias" label="Nenhum imóvel meu passa de … dias sem revisão" tipo="int" />
            <Campo
              k="rv.ritual"
              label="Meu ritual de revisão acontece…"
              ph={
                S["sp.dia"]
                  ? `ex.: toda ${nomeDia(S["sp.dia"]).toLowerCase()}`
                  : "o mesmo dia da semana padrão"
              }
            />
          </Bloco>
          <div className="grid grid-cols-2 gap-2">
            <Stat v="6 em 10" rot="vende quem revisa após 90 dias" />
            <Stat v="3 em 10" rot="vende quem nunca revisa" />
          </div>
          <p className="text-xs text-muted-foreground">
            Dado fixo da rede REMAX (BI REMAX Brasil, set/2026), igual para todos: não muda com o
            que você digita.
          </p>
        </>
      );
    case "p39":
      return (
        <>
          <Bloco ajuda="p39.canais">
            {C.top3.length ? (
              <Aviso tom="green">
                Suas 3 maiores origens do ano passado: <b>{C.top3.join(", ")}</b>
              </Aviso>
            ) : (
              <Aviso>
                Suas 3 maiores origens aparecem aqui quando você preencher a tabela de{" "}
                <Origem id="p16" irPara={extras?.irPara} />.
              </Aviso>
            )}
            {CANAIS.map((c, i) => (
              <Check key={i} k={`mk.${i}`}>
                {c}
              </Check>
            ))}
            {C.canais.length > 3 ? (
              <Aviso>
                ⚠ Você marcou {C.canais.length}. O book pede no máximo 3 canais para concentrar o
                investimento.
              </Aviso>
            ) : (
              <p className="text-xs text-muted-foreground">{C.canais.length}/3 escolhidos.</p>
            )}
          </Bloco>
          <Bloco>
            <Campo
              k="mk.invest"
              label="Quanto vou investir por mês (R$)"
              tipo="money"
              ajuda="p39.invest"
            />
            {ok(C.invest) ? (
              <Aviso tom={Math.abs(C.invest - C.mktNegocioMes) > 1 ? "amber" : "green"}>
                Você vai investir <b>{fmt.brl(C.invest)}/mês</b> (o que digitou acima). Seu
                orçamento do negócio, em <Origem id="p23" irPara={extras?.irPara} />, prevê{" "}
                <b>{fmt.brl(C.mktNegocioMes)}/mês</b> (marketing de captação + venda + Portal
                Boost); esse segundo número só muda lá.
                {Math.abs(C.invest - C.mktNegocioMes) > 1
                  ? " Os dois estão diferentes; ajuste um deles."
                  : " Bate ✔"}
              </Aviso>
            ) : null}
          </Bloco>
          <details className="rounded-xl border bg-card">
            <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold">
              O que é obrigatório, em qualquer canal
            </summary>
            <ol className="list-decimal px-8 pb-3 text-[13px]">
              <li>Região de posicionamento definida com o seu broker</li>
              <li>Marketing pessoal no padrão REMAX</li>
              <li>Imóvel cadastrado no iList antes de qualquer divulgação</li>
              <li>Plano de Marketing e Venda apresentado na V2 e cumprido</li>
              <li>Toda origem de negócio registrada no CRM</li>
            </ol>
          </details>
        </>
      );
    case "p40":
      return (
        <>
          <Bloco titulo="O que eu preciso aprender em 2027" ajuda="p40.aprender">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <h4 className="mt-3 text-sm font-semibold text-primary">Habilidade {i + 1}</h4>
                <Campo
                  k={`de.h.${i}`}
                  label="Habilidade que quero desenvolver"
                  ph={i === 0 ? "ex.: apresentar a ACM com segurança" : ""}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Campo k={`de.n.${i}`} label="Número que ela melhora" ph="ex.: conversão" />
                  <Campo k={`de.o.${i}`} label="Onde vou aprender" ph="ex.: Escola REMAX" />
                </div>
              </div>
            ))}
          </Bloco>
          <Bloco titulo="Minha agenda" ajuda="p40.agenda">
            {AGENDA.map((a, i) => (
              <Linha key={i} k={`de.a.${i}`} rot={a} tipo="text" ph="quando?" />
            ))}
            <Campo
              k="de.horas"
              label="Horas por semana reservadas para aprender"
              tipo="int"
              ph="ex.: 3"
            />
          </Bloco>
        </>
      );
    case "p43":
      return <PainelMensal C={C} />;
    case "p44":
      return <Semanal />;
    case "p45":
      return (
        <>
          <Bloco titulo="Corretor" ajuda="p45.corretor">
            <Campo k="pa.nome" label="Eu," />
            <p className="mt-1 text-sm">me comprometo a:</p>
            {[0, 1, 2].map((i) => (
              <Campo key={i} k={`pa.c.${i}`} label={`0${i + 1}`} />
            ))}
          </Bloco>
          <Bloco titulo="Broker" ajuda="p45.broker">
            <Campo k="pa.bnome" label="Eu," ph="nome do broker" />
            <p className="mt-1 text-sm">me comprometo a:</p>
            {[0, 1, 2].map((i) => (
              <Campo key={i} k={`pa.b.${i}`} label={`0${i + 1}`} />
            ))}
            <p className="mt-1 text-xs text-muted-foreground">
              Combine com o seu broker. Ele assina pelo painel de gestão depois de você.
            </p>
          </Bloco>
          <Bloco titulo="Nossa cadência de acompanhamento" ajuda="p45.cadencia">
            <Selecao
              k="pa.cad"
              label="Frequência"
              opcoes={[
                ["semanal", "Semanal"],
                ["quinzenal", "Quinzenal"],
                ["mensal", "Mensal"],
              ]}
            />
            <div className="grid grid-cols-2 gap-2">
              <Selecao k="pa.dia" label="Sempre às" opcoes={DIAS} ph="dia…" />
              <Campo k="pa.hora" label="às" tipo="time" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Nesta conversa vamos olhar sempre: captações do período, imóveis revisados, carteira
              ativa e comissão do mês.
            </p>
          </Bloco>
          {extras?.p45}
        </>
      );
    case "p49": {
      // Dia 1 vindo do banco (escolheu a trilha Ativação antes do caminho único): fica fixo, como antes.
      const fixo = !!inicio && inicio !== S["d90.inicio"];
      const d45 = inicio ? addDias(inicio, 45) : null;
      const d90 = inicio ? addDias(inicio, 90) : null;
      const cre1 = typeof S["d90.cre1"] === "string" ? (S["d90.cre1"] as string) : "";
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat v="3,8×" rot="vende mais quem assina a 1ª CRE até o dia 45" />
            <Stat v="7 em 10" rot="vendem no 1º ano com 3 CREs em 90 dias" />
          </div>
          <Bloco titulo="Minhas datas-alvo" ajuda="p49.datas">
            {/* Dia 1: ativacao_inicio já gravado (quem escolheu Ativação antes) ou a data marcada aqui. */}
            {!fixo && !ro ? (
              <Campo
                k="d90.inicio"
                label="Meu dia 1 (os 90 dias contam daqui)"
                tipo="date"
                hint="Use o dia em que você começou na imobiliária ou o dia em que começa este plano."
              />
            ) : null}
            <p className="text-sm text-muted-foreground" data-testid="p49-inicio">
              {inicio ? (
                <>
                  Início dos 90 dias: <b>{dataBR(inicio)}</b> · dia 45 = <b>{dataBR(d45)}</b> · dia
                  90 = <b>{dataBR(d90)}</b>
                </>
              ) : (
                "Os 90 dias contam a partir do seu dia 1. Marque a data acima."
              )}
            </p>
            <Campo k="d90.cre1" label="Primeira CRE assinada (até o dia 45)" tipo="date" />
            <Campo k="d90.cre3" label="Três CREs (até o dia 90)" tipo="date" />
            <Campo k="d90.venda1" label="Primeira venda" tipo="date" />
            {cre1 && d45 && cre1 > d45 ? (
              <Aviso>⚠ Sua 1ª CRE está para depois do dia 45.</Aviso>
            ) : null}
          </Bloco>
          <Bloco ajuda="p49.apoio">
            <Campo k="d90.parceiro" label="Quem é o meu parceiro de cobrança (colega ou broker)" />
            <Campo
              k="d90.aprender"
              label="O que eu preciso aprender nos próximos 30 dias"
              tipo="area"
            />
          </Bloco>
        </>
      );
    }
    case "p50":
      return (
        <>
          {SEMANAS.map((s, i) => {
            const f = s.itens.filter((_, j) => S[`sem.${i}.${j}`] === true).length;
            return (
              <Bloco
                key={i}
                ajuda="p50.semana"
                titulo={
                  <span className="flex items-center gap-2">
                    {s.t}
                    <Pill tom={f === s.itens.length ? "green" : "blue"}>
                      {f}/{s.itens.length}
                    </Pill>
                  </span>
                }
              >
                {s.itens.map((t, j) => (
                  <Check key={j} k={`sem.${i}.${j}`}>
                    {t}
                  </Check>
                ))}
              </Bloco>
            );
          })}
        </>
      );
    case "p51":
      return (
        <>
          <Bloco titulo="Marcos da primeira captação" ajuda="p51.captacao">
            {MARCOS_CAPT.map((m, j) => (
              <Check key={j} k={`mc.c.${j}`}>
                {m}
              </Check>
            ))}
            <Campo k="mc.dataCapt" label="Data da minha primeira captação" tipo="date" />
          </Bloco>
          <Bloco titulo="Marcos da primeira venda" ajuda="p51.venda">
            {MARCOS_VENDA.map((m, j) => (
              <Check key={j} k={`mc.v.${j}`}>
                {m}
              </Check>
            ))}
            <Campo k="mc.dataVenda" label="Data da minha primeira venda" tipo="date" />
          </Bloco>
        </>
      );
    case "p52":
      return <Cockpit irPara={extras?.irPara} />;
    default:
      return null;
  }
}

function TelaMetas({ extra, irPara }: { extra?: ReactNode; irPara?: (id: string) => void }) {
  const { C } = usePlanoCtx();
  const sug = (v: number, money?: boolean) =>
    ok(v) ? `sugestão: ${money ? fmt.brl0(v) : fmt.int(v)}` : "";
  return (
    <>
      <Bloco className="border-rose-900/40">
        <Pill tom="red">OBJETIVO 2027</Pill>
        <p className="mt-2 text-base">
          Ao final de 2027 eu terei <b>{fmt.int(C.creFim)}</b> CREs ativas na minha carteira e o
          valor geral de comissão de <b>{fmt.brl0(C.vgc)}</b>, atingindo o <b>{C.clube || "—"}</b>.
        </p>
        <details className="mt-2 text-xs" data-testid="de-onde-vem">
          <summary className="cursor-pointer font-semibold">De onde vem cada número</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              <b>{fmt.int(C.creFim)} CREs ativas</b>: {fmt.int(C.creIni)} no início (do diagnóstico,{" "}
              <Origem id="p15" irPara={irPara} />) + {fmt.int(C.novas)} novas (captações do ano,{" "}
              <Origem id="p30" irPara={irPara} />) − {fmt.int(C.canc)} canceladas/expiradas −{" "}
              {fmt.int(C.vendidas)} vendidas. Os campos abaixo trocam qualquer um deles.
            </li>
            <li>
              <b>VGC {fmt.brl0(C.vgc)}</b>: {fmt.int(C.transMeta)} transações ×{" "}
              {fmt.brl0(C.comMedia)} de comissão média (ticket × % de comissão,{" "}
              <Origem id="p27" irPara={irPara} />
              ).
            </li>
            <li>
              <b>{C.clube || "Clube"}</b>:{" "}
              {C.clubeSug && C.clube === C.clubeSug.n
                ? `faixa do seu VGC (a partir de ${fmt.brl0(C.clubeSug.min)}, tabela dos Clubes de Corretores, ${rotuloPagina(28)})`
                : C.clube
                  ? "escolhido por você"
                  : "aparece quando houver VGC"}
              .
            </li>
          </ul>
        </details>
      </Bloco>
      <Bloco titulo="CREs (captações com representação exclusiva)" ajuda="p32.cres">
        <Linha
          k="mt.creIni"
          rot="Quantidade inicial de CREs ativas"
          tipo="int"
          ph={sug(C.d.ativos)}
        />
        <Linha
          k="mt.novas"
          rot="Meta de novas CREs"
          sub="sugestão: captações do ano"
          tipo="int"
          ph={sug(C.captAno)}
        />
        <Linha
          k="mt.canc"
          rot="Meta de CREs canceladas/expiradas"
          sub="as que a conversão não vende"
          tipo="int"
          ph={sug(C.canc)}
        />
        <Linha
          k="mt.vendidas"
          rot="Meta de CREs vendidas"
          sub="sugestão: novas × conversão"
          tipo="int"
          ph={sug(C.vendidas)}
        />
        <Conta
          rot="Estoque no fim do ano (início + novas − canceladas − vendidas)"
          v={C.estoqueFim}
          f="int"
        />
        <Linha
          k="mt.creFim"
          rot="Meta de CREs ativas no fim de 2027"
          tipo="int"
          ph={sug(C.estoqueFim)}
        />
      </Bloco>
      <TabelaMesBloco id="cres" />
      <Bloco titulo="Valor geral de comissão (VGC)" ajuda="p32.vgc">
        <Linha k="mt.tCapt" rot="Meta de transações de captação" tipo="int" ph={sug(C.trans)} />
        <Linha
          k="mt.tVenda"
          rot="Meta de transações de venda"
          sub="lado comprador (se também atende compradores)"
          tipo="int"
          ph="0"
        />
        <Linha
          k="mt.comMedia"
          rot="Comissão média por transação"
          tipo="money"
          ph={sug(C.comTrans, true)}
        />
        <Conta rot="Meta de transações (captação + venda)" v={C.transMeta} f="int" />
        <Conta rot="META DE VGC (transações × comissão média)" v={C.vgc} f="brl0" main />
        <Selecao
          k="mt.clube"
          label="Clube que quero conquistar em 2027"
          opcoes={CLUBES.map((c) => [c.n, c.n])}
        />
        {C.clubeSug ? (
          <Aviso tom="green">
            Pelo seu VGC de {fmt.brl0(C.vgc)}, a faixa é <b>{C.clubeSug.n}</b> (a partir de{" "}
            {fmt.brl0(C.clubeSug.min)}).
          </Aviso>
        ) : ok(C.vgc) ? (
          <Aviso>VGC abaixo do Executive Club (R$ 173.010).</Aviso>
        ) : null}
      </Bloco>
      <TabelaMesBloco id="vgc" />
      {extra}
    </>
  );
}

/**
 * Tabela mês a mês de um bloco (cartilha; maquete t_88a3e82e). Linhas digitáveis gravam
 * mt.mes.<linha>.<n> (vazio = sugestão cinza no placeholder); linhas "=" são calculadas e não editam.
 * Computador: Anual + Jan…Dez lado a lado. Celular: um mês por linha. Só planejamento: não muda calc().
 */
function TabelaMesBloco({ id }: { id: IdTabelaMes }) {
  const { S, C, set, ro } = usePlanoCtx();
  const t = tabelasMes(S, C).find((x) => x.id === id)!;
  const digitadas = t.linhas.filter((l) => !l.calc);
  const algum = digitadas.some((l) => l.algumDigitado);
  const valor = (l: LinhaMes, v: number) => (l.dinheiro ? fmt.int(v) : fmt.dec(v));
  const limpar = () => chavesTabela(id).forEach((k) => cheio(S[k]) && set(k, ""));
  const celInp = (l: LinhaMes, i: number, cls: string) => (
    <Inp
      k={chaveMes(l.id as IdLinhaDigita, i + 1)}
      tipo={l.dinheiro ? "money" : "int"}
      ph={ok(l.meses[i].sugestao) ? valor(l, l.meses[i].sugestao) : ""}
      label={`${l.rot} em ${MESES[i]}`}
      className={cls}
    />
  );
  const conferencia = (l: LinhaMes) =>
    l.diverge ? (
      <span className="block text-[10px] font-semibold leading-tight text-red-700 dark:text-red-300">
        ⚠ meta do ano: {l.dinheiro ? fmt.brl0(l.meta) : fmt.dec(l.meta)}
      </span>
    ) : ok(l.meta) && ok(l.anual) ? (
      <span className="block text-[10px] leading-tight text-emerald-700 dark:text-emerald-300">
        ✓ bate com o ano
      </span>
    ) : l.notaAnual ? (
      <span className="block text-[10px] leading-tight text-muted-foreground">({l.notaAnual})</span>
    ) : null;
  const cnCalc = "bg-sky-50 font-semibold text-sky-800 dark:bg-sky-950/40 dark:text-sky-200";
  return (
    <section className="rounded-xl border bg-card p-3" data-testid={`dist-mes-${id}`}>
      <h4 className="text-sm font-semibold">
        {t.titulo}
        {algum ? "" : " (÷ 12)"}
      </h4>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="rounded border bg-background px-1.5 py-0.5">você digita</span>
        <span className="rounded border bg-background px-1.5 py-0.5">
          cinza = sugestão {id === "vgc" ? "(ano ÷ 12; comissão = valor do ano)" : "(ano ÷ 12)"}
        </span>
        <span className={cn("rounded px-1.5 py-0.5", cnCalc)}>= azul: calculado (não edita)</span>
        {!ro ? (
          <button
            type="button"
            onClick={limpar}
            disabled={!algum}
            className="ml-auto rounded border px-2 py-0.5 text-[11px] font-medium text-foreground disabled:opacity-40"
            data-testid={`dist-limpar-${id}`}
          >
            Voltar tudo para a sugestão
          </button>
        ) : null}
      </div>

      {/* Computador: Anual + 12 meses sem rolagem lateral. */}
      <table className="mt-2 hidden w-full table-fixed border-collapse text-[11px] md:table">
        <colgroup>
          <col className="w-[104px]" />
          <col className="w-[68px]" />
          {MESES.map((m) => (
            <col key={m} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-slate-800 text-white">
            <th className="rounded-tl px-1.5 py-1 text-left font-semibold">Meta</th>
            <th className="bg-slate-600 px-1 py-1 font-semibold">Anual</th>
            {MESES.map((m, i) => (
              <th key={m} className={cn("px-0.5 py-1 font-semibold", i === 11 && "rounded-tr")}>
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.linhas.map((l) => (
            <tr
              key={l.id}
              className={cn("border-b", l.calc && cnCalc)}
              data-testid={`dist-linha-${l.id}`}
            >
              <td className="px-1 py-1 text-[10.5px] leading-tight">
                {l.calc ? "= " : ""}
                {l.rot}
                {l.dinheiro ? " (R$)" : ""}
              </td>
              <td
                className="bg-muted/60 px-1 py-1 text-center font-semibold"
                data-testid={`dist-anual-${l.id}`}
              >
                {valor(l, l.anual)}
                {conferencia(l)}
              </td>
              {MESES.map((m, i) => (
                <td
                  key={m}
                  className={cn(
                    "px-[1px] py-1 text-center tabular-nums",
                    l.dinheiro && "text-[9.5px] tracking-tighter",
                  )}
                >
                  {l.calc
                    ? valor(l, l.meses[i].usado)
                    : celInp(
                        l,
                        i,
                        cn(
                          "h-7 w-full min-w-0 px-0 text-center text-[11px] md:text-[11px]",
                          l.dinheiro && "text-[9.5px] tracking-tighter md:text-[9.5px]",
                        ),
                      )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Celular: um mês por linha. */}
      <table className="mt-2 w-full table-fixed border-collapse text-[11px] md:hidden">
        <colgroup>
          <col className="w-[34px]" />
          {t.linhas.map((l) => (
            <col key={l.id} className={l.dinheiro ? "w-[22%]" : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-slate-800 text-white">
            <th className="px-1 py-1 text-left font-semibold">Mês</th>
            {t.linhas.map((l) => (
              <th
                key={l.id}
                className={cn("px-0.5 py-1 font-semibold leading-tight", l.calc && "bg-sky-800")}
              >
                {l.calc ? "= " : ""}
                {l.curto}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MESES.map((m, i) => (
            <tr key={m} className="border-b">
              <td className="px-1 py-1 font-semibold">{m}</td>
              {t.linhas.map((l) => (
                <td key={l.id} className={cn("px-[1px] py-1 text-center", l.calc && cnCalc)}>
                  {l.calc ? (
                    <span className="tabular-nums">{valor(l, l.meses[i].usado)}</span>
                  ) : (
                    celInp(l, i, "h-8 w-full min-w-0 px-0.5 text-center text-xs md:text-xs")
                  )}
                </td>
              ))}
            </tr>
          ))}
          <tr className="bg-muted/60">
            <td className="px-1 py-1 font-semibold">Ano</td>
            {t.linhas.map((l) => (
              <td
                key={l.id}
                className={cn("px-0.5 py-1 text-center font-semibold", l.calc && cnCalc)}
              >
                {valor(l, l.anual)}
                {conferencia(l)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {t.linhas
        .filter((l) => l.diverge)
        .map((l) => (
          <Aviso key={l.id}>
            {l.rot}: seus meses somam <b>{l.dinheiro ? fmt.brl0(l.anual) : fmt.dec(l.anual)}</b>; a
            meta do ano é <b>{l.dinheiro ? fmt.brl0(l.meta) : fmt.dec(l.meta)}</b>. Os meses não
            mudam a meta do ano.
          </Aviso>
        ))}
      <p className="mt-2 text-[11px] italic text-muted-foreground">
        {id === "cres"
          ? "Como calcular estoque: imóveis ativos no início + novas − canceladas/expiradas − vendidas (acumulado mês a mês; o anual é dezembro)."
          : "Como calcular transações: captação + venda · VGC: transações × comissão média do mês."}
      </p>
    </section>
  );
}

/** Quadro de KRIs: a frase do Objetivo vem das Metas (mesmos números, sem campo novo); só as 6 ações são digitadas. */
function TelaKris({ irPara }: { irPara?: (id: string) => void }) {
  const { C } = usePlanoCtx();
  return (
    <>
      <Bloco className="border-rose-900/40">
        <Pill tom="red">OBJETIVO 2027</Pill>
        <p className="mt-2 text-base" data-testid="kri-objetivo">
          Ao final de 2027 eu terei <b>{fmt.int(C.creFim)}</b> CREs ativas na minha carteira e o
          valor geral de comissão de <b>{fmt.brl0(C.vgc)}</b>, atingindo o <b>{C.clube || "—"}</b>.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Estes números vêm de <Origem id="p32" irPara={irPara} />; para mudar, corrija lá.
        </p>
      </Bloco>
      {KRIS.map((g) => (
        <Bloco key={g.kri} titulo={g.kri} ajuda="p11.acoes">
          {g.kpis.map((p) => (
            <Campo
              key={p.k}
              k={p.k}
              label={
                <>
                  KPI · {p.n}
                  <small className="block text-xs font-normal text-muted-foreground">
                    Ações principais
                  </small>
                </>
              }
              tipo="area"
              ph="Quais ações você vai repetir toda semana para mover este número?"
              hint={`Exemplo do book: ${p.ex.join(" · ")}.`}
            />
          ))}
        </Bloco>
      ))}
      <Citacao>
        O objetivo orienta as ações; as ações, repetidas toda semana, produzem os resultados que
        levam você ao objetivo.
      </Citacao>
    </>
  );
}

function PainelMensal({ C }: { C: Calc }) {
  const meta = [C.novas, C.creFim, ok(C.revisarMes) ? C.revisarMes * 12 : NaN, C.transMeta, C.vgc];
  return (
    <>
      <Aviso>
        Tela recorrente: a linha META DO ANO já vem do seu plano. O preenchimento automático dos
        meses fica para a fase 2.
      </Aviso>
      <Bloco ajuda="p43.painel">
        <div className="overflow-x-auto">
          <table className="min-w-[520px] text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left">Mês</th>
                <th>Novas CREs</th>
                <th>CREs ativas</th>
                <th>CREs revisadas</th>
                <th>Transações</th>
                <th>Comissão</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-primary/10 font-semibold">
                <td className="py-1">META DO ANO</td>
                {meta.map((v, i) => (
                  <td key={i} className="text-center">
                    {i === 4 ? fmt.brl0(v) : fmt.int(v)}
                  </td>
                ))}
              </tr>
              {MESES.map((m) => (
                <tr key={m} className="border-t">
                  <td className="py-1">{m}</td>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <td key={i} className="text-center text-muted-foreground">
                      ·
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bloco>
      <Citacao>
        A regra do primeiro mês: fechou um mês sem comissão? Na mesma semana, sente com o seu broker
        e revisem o funil e a carteira.
      </Citacao>
    </>
  );
}

function Semanal() {
  const { S, C } = usePlanoCtx();
  const L: [string, number | null][] = [
    ["Contatos com agendamento", C.contSem],
    ["Primeiras visitas (V1)", Math.ceil(C.v1Mes / 4)],
    ["Segundas visitas (V2)", Math.ceil(C.v2Mes / 4)],
    ["CREs assinadas", Math.ceil(C.captMes / 4)],
    ["Imóveis com preço revisado", Math.ceil(C.revisarMes / 4)],
    ["Visitas com compradores", null],
    ["Propostas formalizadas", null],
    ["Transações fechadas", C.transMeta / 12 / 4],
    ["Pontos da regra dos 4 pontos", 20],
  ];
  return (
    <Bloco ajuda="p44.semana">
      <Campo k="ac.mes" label="Mês de referência" ph="ex.: janeiro/2027" />
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-[520px] text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 text-left">Atividade</th>
              <th>Sem 1</th>
              <th>Sem 2</th>
              <th>Sem 3</th>
              <th>Sem 4</th>
              <th>Total</th>
              <th>Meta/sem</th>
            </tr>
          </thead>
          <tbody>
            {L.map(([n, m], i) => (
              <tr key={n} className="border-t">
                <td className="py-1 pr-2">{n}</td>
                {[0, 1, 2, 3].map((w) => (
                  <td key={w} className="px-0.5">
                    <Inp
                      k={`ac.${i}.${w}`}
                      tipo="int"
                      ph=""
                      label={`${n}, semana ${w + 1}`}
                      className="h-9 w-14 px-1 text-center"
                    />
                  </td>
                ))}
                <td className="text-center font-semibold">
                  {fmt.int(soma([0, 1, 2, 3].map((w) => num(S[`ac.${i}.${w}`]))))}
                </td>
                <td className="text-center font-semibold">
                  {m == null ? "—" : i === 7 ? fmt.dec(m) : fmt.int(m)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Meta da semana vem do funil (contatos, V1, V2, CREs ÷ 4) e da régua de revisão. Pontos: meta
        20 por semana.
      </p>
    </Bloco>
  );
}

function LinhaCk({
  rot,
  val,
  ref_,
  irPara,
}: {
  rot: string;
  val: string;
  ref_?: string;
  irPara?: (id: string) => void;
}) {
  const tem = !!val && val !== "—";
  const p = ref_ ? tela(ref_) : undefined;
  const naTrilha = ref_ ? ORDEM.includes(ref_) : false;
  return (
    <div className="flex justify-between gap-3 border-b border-dashed py-2 text-sm last:border-0">
      <span>
        {rot}{" "}
        {p ? (
          irPara && naTrilha ? (
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline"
              onClick={() => irPara(p.id)}
            >
              {rotuloPagina(p.pdf)} ✎
            </button>
          ) : (
            <span className="text-[11px] text-muted-foreground">{rotuloPagina(p.pdf)}</span>
          )
        ) : null}
      </span>
      <span
        className={
          tem
            ? "max-w-[55%] text-right font-semibold"
            : "max-w-[55%] text-right text-muted-foreground"
        }
      >
        {tem ? val : "—"}
      </span>
    </div>
  );
}

export function Cockpit({ irPara }: { irPara?: (id: string) => void }) {
  const { S, C } = usePlanoCtx();
  const s = (k: string) => (typeof S[k] === "string" ? (S[k] as string) : "");
  const horas = [C.horasCapt, C.horasAtend, C.horasEstudo]
    .map((x) => (ok(x) && x > 0 ? `${x}h` : "—"))
    .join(" · ");
  const Sec = ({ children }: { children: ReactNode }) => (
    <div className="mt-3 text-xs font-bold tracking-wide text-rose-900 dark:text-rose-300">
      {children}
    </div>
  );
  return (
    <>
      <Bloco>
        <Sec>MEU PORQUÊ E MEU NÚMERO</Sec>
        <LinhaCk rot="Meu porquê, em uma frase" val={s("pq.frase")} ref_="p20" irPara={irPara} />
        <LinhaCk
          rot="Número do meu estilo de vida: por ano"
          val={ok(C.estiloAno) ? fmt.brl(C.estiloAno) : ""}
          ref_="p25"
          irPara={irPara}
        />
        <LinhaCk
          rot="Número do meu estilo de vida: por mês"
          val={ok(C.estiloMes) ? fmt.brl(C.estiloMes) : ""}
          ref_="p25"
          irPara={irPara}
        />
        <Sec>MINHA ROTINA</Sec>
        <LinhaCk
          rot="Horas/semana: captação · atendimento · desenvolvimento"
          val={horas}
          ref_="p36"
          irPara={irPara}
        />
        <LinhaCk
          rot="Dia fixo da revisão de preço"
          val={nomeDia(S["sp.dia"]) ?? ""}
          ref_="p36"
          irPara={irPara}
        />
        <LinhaCk
          rot="Funil do mês: prospecções · V1 · V2 · captações"
          val={[C.contMes, C.v1Mes, C.v2Mes, C.captMes].map(fmt.int).join(" · ")}
          ref_="p37"
          irPara={irPara}
        />
        <LinhaCk
          rot="Canais de marketing · investimento/mês"
          val={!C.canais.length ? "" : `${C.canais.join(", ")} · ${fmt.brl0(C.invest)}`}
          ref_="p39"
          irPara={irPara}
        />
        <LinhaCk
          rot="Habilidade nº 1 · horas de estudo/semana"
          val={!s("de.h.0") ? "" : `${s("de.h.0")} · ${s("de.horas") || "—"}h`}
          ref_="p40"
          irPara={irPara}
        />
        <Sec>ONDE EU JOGO / POSICIONAMENTO</Sec>
        <LinhaCk rot="Minha região" val={s("pos.regiao")} ref_="p34" irPara={irPara} />
        <LinhaCk
          rot="Tipo de imóvel e faixa de preço"
          val={
            !s("pos.tipo")
              ? ""
              : `${s("pos.tipo")} · ${fmt.brl0(num(S["pos.de"]))} a ${fmt.brl0(num(S["pos.ate"]))}`
          }
          ref_="p34"
          irPara={irPara}
        />
        <Sec>MINHA META 2027</Sec>
        <LinhaCk
          rot="Transações que preciso fechar no ano"
          val={ok(C.trans) ? fmt.int(C.trans) : ""}
          ref_="p27"
          irPara={irPara}
        />
        <LinhaCk
          rot="Captações no ano · por mês"
          val={ok(C.captAno) ? `${fmt.int(C.captAno)} · ${fmt.int(C.captMes)}` : ""}
          ref_="p30"
          irPara={irPara}
        />
        <LinhaCk
          rot="CREs ativas no fim de 2027"
          val={ok(C.creFim) ? fmt.int(C.creFim) : ""}
          ref_="p32"
          irPara={irPara}
        />
        <LinhaCk
          rot="VGC de 2027 · clube"
          val={ok(C.vgc) ? `${fmt.brl0(C.vgc)} · ${C.clube || "—"}` : ""}
          ref_="p32"
          irPara={irPara}
        />
        <Sec>MEUS PRIMEIROS 90 DIAS</Sec>
        <LinhaCk
          rot="1ª CRE · 3 CREs · 1ª venda"
          val={[s("d90.cre1"), s("d90.cre3"), s("d90.venda1")].map((x) => dataBR(x)).join(" · ")}
          ref_="p49"
          irPara={irPara}
        />
        <Sec>COMO EU EXECUTO</Sec>
        <LinhaCk
          rot="Dia e hora do acompanhamento"
          val={s("pa.cad") ? `${s("pa.cad")} · ${nomeDia(S["pa.dia"])} ${s("pa.hora")}` : ""}
          ref_="p45"
          irPara={irPara}
        />
        <LinhaCk
          rot="Compromisso nº 1 do meu pacto com o broker"
          val={s("pa.c.0")}
          ref_="p45"
          irPara={irPara}
        />
        <LinhaCk rot="Meu broker" val={s("pa.bnome")} ref_="p45" irPara={irPara} />
      </Bloco>
      <Aviso>
        Regra do cockpit: se um número daqui mudar, muda no plano também. Revise a página inteira a
        cada 90 dias.
      </Aviso>
    </>
  );
}
