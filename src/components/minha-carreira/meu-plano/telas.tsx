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
import { ORDEM, P15_CAMPOS, rotuloPagina, tela } from "@/lib/meu-plano-2027/telas";
import { Pill } from "@/components/visual/base";
import {
  Aviso,
  Bloco,
  Campo,
  Check,
  Citacao,
  Conta,
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

export const SEMANAS = [
  {
    t: "SEMANA 1 — Me preparar",
    itens: [
      "CRECI e cadastro na unidade em dia",
      "Foto profissional, cartão e assinatura de e-mail no padrão REMAX",
      "Acesso ao iList e ao MaxCenter funcionando",
      "Estudar a Cartilha Corretor - Introdução até Passo 1 - Posicionamento",
      "Mensagem sobre a nova carreira para 20 pessoas da agenda, por dia",
      "Reuniões da imobiliária, inscrição no FIC, aulas da Universidade REMAX",
      "Definir com o broker a minha região de posicionamento",
    ],
  },
  {
    t: "SEMANA 2 — Conhecer a minha região",
    itens: [
      "Continuar as 20 mensagens por dia",
      "Configurar o Instagram (bio) e o WhatsApp Business",
      "Posicionamento: visitar os comércios da região e me apresentar",
      "Listar os imóveis à venda na região, inclusive os vendidos pelo proprietário",
      "Mapear a região com as fichas de pesquisa de posicionamento",
      "Acompanhar um colega em uma primeira visita (V1)",
    ],
  },
  {
    t: "SEMANA 3 — Ativar a minha rede",
    itens: [
      "Montar a minha lista FROG e cadastrar no CRM",
      "Continuar as 20 mensagens por dia",
      "Entregar a carta aos vizinhos na minha região",
      "Montar o meu dossiê do corretor",
      "Ações diárias de posicionamento",
      "Direct para 10 pessoas do Instagram por dia",
      "3 contatos por dia com “à venda pelo proprietário”",
    ],
  },
  {
    t: "SEMANA 4 — Ir a mercado",
    itens: [
      "Agendar e realizar a minha primeira V1",
      "Montar a minha primeira ACM e validar com o broker",
      "Treinar a V2 em role-play com o broker",
      "Revisar as 4 semanas com o meu parceiro de cobrança",
    ],
  },
];
const MARCOS_CAPT = [
  "Primeira visita (V1) realizada, com o dossiê do corretor",
  "Segunda visita (V2): Plano de Marketing e Venda apresentado e ACM validada com o broker",
  "CRE assinada por todos os proprietários",
  "Documentação do imóvel e dos proprietários validada",
  "Home staging, fotos profissionais e dossiê do imóvel prontos",
  "Imóvel cadastrado no iList e publicado nos portais",
  "Placa, carta aos vizinhos e parceria 50/50 ativadas",
  "Feedback semanal e régua de revisão agendados",
];
const MARCOS_VENDA = [
  "Primeira visita de comprador realizada, com ficha de visita",
  "Primeira proposta formalizada por escrito",
  "Proposta aceita e condições registradas",
  "Contrato de compra e venda assinado",
  "Comissão recebida",
];
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const BLOCOS_SEMANA: [string, string][] = [
  [
    "Posicionamento e prospecção",
    "Presença na região (mín. 1h/dia), lista FROG, FSBO, ligações e agendamentos",
  ],
  ["Visitas ao proprietário", "V1, V2, preparo do Plano de Marketing e Venda e da ACM"],
  ["Atendimento ao comprador", "Visitas com compradores, propostas, negociação"],
  [
    "Acompanhamento e revisão",
    "Relatório semanal ao proprietário, imóveis parados, revisão de preço",
  ],
];

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

export function CorpoTela({ id, extras }: { id: string; extras?: Extras }) {
  const { S, C, inicio, trilha } = usePlanoCtx();
  switch (id) {
    case "p15":
      return (
        <>
          {extras?.p15}
          <Bloco>
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
          <Bloco>
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
          <Bloco titulo="Minhas 3 maiores origens do ano (automático)">
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
        <Bloco>
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
          <Bloco>
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
            />
          </Bloco>
        </>
      );
    case "p22":
      return (
        <>
          <Bloco>
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
        <Bloco>
          {NEGOCIO.map((g, i) => (
            <Linha key={i} k={`on.${i}`} rot={g[0]} sub={g[1]} />
          ))}
          <Conta rot="Total mensal" v={C.negocioMes} />
          <Conta rot="Total anual (× 12)" v={C.negocioAno} main />
        </Bloco>
      );
    case "p24":
      return (
        <Bloco>
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
              hint="Use a alíquota efetiva que você já paga; se não souber, pergunte ao seu contador. Não é orientação fiscal."
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
          <Bloco>
            <Conta rot="1 · O número do meu estilo de vida" v={C.estiloAno} />
            <Selecao
              k="m.faixa"
              label="2 · Minha faixa de comissionamento hoje"
              opcoes={FAIXAS.map((f) => [String(f[0]), f[1]])}
            />
            <Conta rot="3 · Comissão bruta que preciso gerar (1 ÷ 2)" v={C.bruta} />
            <Campo
              k="m.ticket"
              label="4 · Meu ticket médio (R$)"
              tipo="money"
              ph={ok(C.d.ticket) ? `do diagnóstico: ${fmt.brl0(C.d.ticket)}` : "ex.: 700.000"}
              hint={
                cheio(S["m.ticket"]) ? (
                  "Valor digitado por você."
                ) : ok(C.d.ticket) ? (
                  <>
                    Em branco: a conta está usando <b>{fmt.brl0(C.d.ticket)}</b> do seu diagnóstico,{" "}
                    <Origem id="p15" irPara={extras?.irPara} />. Digite aqui só se quiser outro
                    valor.
                  </>
                ) : trilha === "ativacao" ? (
                  "Ainda sem histórico? Use o preço médio dos imóveis da sua região."
                ) : (
                  <>
                    ⚠ Falta o ticket: preencha o diagnóstico em{" "}
                    <Origem id="p15" irPara={extras?.irPara} /> ou digite aqui.
                  </>
                )
              }
            />
            <Campo
              k="m.pct"
              label="5 · Percentual de comissão por transação (%)"
              tipo="pct"
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
          <Bloco titulo="Minha próxima faixa e meu clube">
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
          <Bloco>
            <Conta rot="1 · Transações que preciso fechar" v={C.trans} f="int" />
            <Campo
              k="m.conv"
              label="2 · Minha conversão da captação (%)"
              tipo="pct"
              ph={ok(C.d.conv) ? `do diagnóstico: ${C.d.conv}%` : "ex.: 22"}
              hint={
                cheio(S["m.conv"]) ? (
                  "Valor digitado por você."
                ) : ok(C.d.conv) ? (
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
          <Bloco titulo="Onde eu quero estar">
            <Radio
              k="m.alvo"
              opcoes={[
                "11 a 15 CREs ativas",
                "16 a 18 CREs ativas",
                "19 ou mais, com estrutura de apoio",
              ]}
            />
          </Bloco>
          <Bloco titulo="Confira a sua conta (automática)">
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
    case "p34":
      return (
        <>
          <Bloco>
            <h4 className="mt-1 text-sm font-semibold text-primary">01 · Região</h4>
            <Campo k="pos.regiao" label="Minha área de atuação" tipo="area" ph="bairros / região" />
            <div className="grid grid-cols-2 gap-2">
              <Campo k="pos.pctHoje" label="Carteira hoje na região (%)" tipo="pct" />
              <Campo k="pos.pctMeta" label="Meta no fim de 2027 (%)" tipo="pct" />
            </div>
            <h4 className="mt-3 text-sm font-semibold text-primary">02 · Tipo de imóvel</h4>
            <Campo k="pos.tipo" label="Tipo em que quero ser referência" />
            <h4 className="mt-3 text-sm font-semibold text-primary">03 · Ticket médio</h4>
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
          <Bloco>
            {BLOCOS_SEMANA.map((b, i) => (
              <Linha key={i} k={`sp.${i}`} rot={b[0]} sub={b[1]} tipo="int" ph="h/sem" />
            ))}
            <Conta rot="TOTAL DE HORAS POR SEMANA" v={C.horasTot} f="int" main />
          </Bloco>
          <Bloco>
            <Selecao k="sp.dia" label="Meu dia de revisão de estoque é" opcoes={DIAS} />
            <p className="mt-1 text-xs text-muted-foreground">
              Trate como reunião com cliente: não se desmarca.
            </p>
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
              ph={`padrão: ${C.txV2Cre}`}
            />
            <Conta rot="Segundas visitas (V2) por mês" v={C.v2Mes} f="int" />
            <Campo
              k="fu.v1v2"
              label="De cada 100 primeiras visitas (V1), quantas viram V2? (%)"
              tipo="pct"
              ph={`padrão: ${C.txV1V2}`}
            />
            <Conta rot="Primeiras visitas (V1) por mês" v={C.v1Mes} f="int" />
            <Campo
              k="fu.folga"
              label="Taxa de folga para quem desmarca (%)"
              tipo="pct"
              ph={`padrão: ${C.folga}`}
              hint="É uma taxa, não o resultado: acrescenta contatos extras para cobrir quem desmarca. O resultado vem logo abaixo."
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
          <Bloco titulo="Minha lista FROG">
            <p className="text-xs text-muted-foreground">
              Família, Relacionamentos, Organizações e Geografia + Clientes já atendidos.
            </p>
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
          <Bloco titulo="Meus compromissos">
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
          <Bloco>
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
            <Campo k="mk.invest" label="Quanto vou investir por mês (R$)" tipo="money" />
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
          <Bloco titulo="O que eu preciso aprender em 2027">
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
          <Bloco titulo="Minha agenda">
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
          <Bloco titulo="Corretor">
            <Campo k="pa.nome" label="Eu," />
            <p className="mt-1 text-sm">me comprometo a:</p>
            {[0, 1, 2].map((i) => (
              <Campo key={i} k={`pa.c.${i}`} label={`0${i + 1}`} />
            ))}
          </Bloco>
          <Bloco titulo="Broker">
            <Campo k="pa.bnome" label="Eu," ph="nome do broker" />
            <p className="mt-1 text-sm">me comprometo a:</p>
            {[0, 1, 2].map((i) => (
              <Campo key={i} k={`pa.b.${i}`} label={`0${i + 1}`} />
            ))}
            <p className="mt-1 text-xs text-muted-foreground">
              Combine com o seu broker. Ele assina pelo painel de gestão depois de você.
            </p>
          </Bloco>
          <Bloco titulo="Nossa cadência de acompanhamento">
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
      const d45 = inicio ? addDias(inicio, 45) : null;
      const d90 = inicio ? addDias(inicio, 90) : null;
      const cre1 = typeof S["d90.cre1"] === "string" ? (S["d90.cre1"] as string) : "";
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat v="3,8×" rot="vende mais quem assina a 1ª CRE até o dia 45" />
            <Stat v="7 em 10" rot="vendem no 1º ano com 3 CREs em 90 dias" />
          </div>
          <Bloco titulo="Minhas datas-alvo">
            <p className="text-sm text-muted-foreground">
              {inicio ? (
                <>
                  Início da sua trilha: <b>{dataBR(inicio)}</b> · dia 45 = <b>{dataBR(d45)}</b> ·
                  dia 90 = <b>{dataBR(d90)}</b>
                </>
              ) : (
                "Os 90 dias contam a partir do dia em que você começa a trilha Ativação."
              )}
            </p>
            <Campo k="d90.cre1" label="Primeira CRE assinada (até o dia 45)" tipo="date" />
            <Campo k="d90.cre3" label="Três CREs (até o dia 90)" tipo="date" />
            <Campo k="d90.venda1" label="Primeira venda" tipo="date" />
            {cre1 && d45 && cre1 > d45 ? (
              <Aviso>⚠ Sua 1ª CRE está para depois do dia 45.</Aviso>
            ) : null}
          </Bloco>
          <Bloco>
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
                titulo={
                  <span className="flex items-center justify-between gap-2">
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
          <Bloco titulo="Marcos da primeira captação">
            {MARCOS_CAPT.map((m, j) => (
              <Check key={j} k={`mc.c.${j}`}>
                {m}
              </Check>
            ))}
            <Campo k="mc.dataCapt" label="Data da minha primeira captação" tipo="date" />
          </Bloco>
          <Bloco titulo="Marcos da primeira venda">
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
      <Bloco titulo="CREs (captações com representação exclusiva)">
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
      <Bloco titulo="Valor geral de comissão (VGC)">
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
      <details className="rounded-xl border bg-card">
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold">
          Distribuição mês a mês (÷ 12)
        </summary>
        <div className="overflow-x-auto px-3 pb-3">
          <table className="min-w-[560px] text-xs">
            <thead>
              <tr>
                <th className="py-1 pr-2 text-left">Meta</th>
                <th className="pr-2">Anual</th>
                {MESES.map((m) => (
                  <th key={m} className="pr-1">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Novas CREs", C.novas],
                  ["Canceladas/expiradas", C.canc],
                  ["CREs vendidas", C.vendidas],
                  ["Transações", C.transMeta],
                  ["VGC (R$ mil)", C.vgc / 1000],
                ] as [string, number][]
              ).map(([n, v]) => (
                <tr key={n} className="border-t">
                  <td className="py-1 pr-2">{n}</td>
                  <td className="pr-2 text-center font-semibold">{fmt.dec(v)}</td>
                  {MESES.map((m) => (
                    <td key={m} className="pr-1 text-center">
                      {fmt.dec(v / 12)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {extra}
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
      <Bloco>
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
    <Bloco>
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
  fora,
}: {
  rot: string;
  val: string;
  ref_?: string;
  irPara?: (id: string) => void;
  fora?: string | null;
}) {
  const { trilha } = usePlanoCtx();
  const tem = !!val && val !== "—";
  const p = ref_ ? tela(ref_) : undefined;
  const naTrilha = ref_ ? ORDEM[trilha].includes(ref_) : false;
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
        {tem ? val : fora || "—"}
      </span>
    </div>
  );
}

export function Cockpit({ irPara }: { irPara?: (id: string) => void }) {
  const { S, C, trilha } = usePlanoCtx();
  const foraA = "não faz parte da trilha Ativação";
  const fora = (id: string) =>
    trilha === "ativacao" && !ORDEM.ativacao.includes(id) ? foraA : null;
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
          val={fora("p36") ? "" : horas}
          ref_="p36"
          irPara={irPara}
          fora={fora("p36")}
        />
        <LinhaCk
          rot="Dia fixo da revisão de preço"
          val={fora("p36") ? "" : (nomeDia(S["sp.dia"]) ?? "")}
          ref_="p36"
          irPara={irPara}
          fora={fora("p36")}
        />
        <LinhaCk
          rot="Funil do mês: prospecções · V1 · V2 · captações"
          val={fora("p37") ? "" : [C.contMes, C.v1Mes, C.v2Mes, C.captMes].map(fmt.int).join(" · ")}
          ref_="p37"
          irPara={irPara}
          fora={fora("p37")}
        />
        <LinhaCk
          rot="Canais de marketing · investimento/mês"
          val={
            fora("p39") || !C.canais.length ? "" : `${C.canais.join(", ")} · ${fmt.brl0(C.invest)}`
          }
          ref_="p39"
          irPara={irPara}
          fora={fora("p39")}
        />
        <LinhaCk
          rot="Habilidade nº 1 · horas de estudo/semana"
          val={fora("p40") || !s("de.h.0") ? "" : `${s("de.h.0")} · ${s("de.horas") || "—"}h`}
          ref_="p40"
          irPara={irPara}
          fora={fora("p40")}
        />
        <Sec>ONDE EU JOGO / POSICIONAMENTO</Sec>
        <LinhaCk
          rot="Minha região"
          val={s("pos.regiao")}
          ref_="p34"
          irPara={irPara}
          fora={fora("p34")}
        />
        <LinhaCk
          rot="Tipo de imóvel e faixa de preço"
          val={
            fora("p34") || !s("pos.tipo")
              ? ""
              : `${s("pos.tipo")} · ${fmt.brl0(num(S["pos.de"]))} a ${fmt.brl0(num(S["pos.ate"]))}`
          }
          ref_="p34"
          irPara={irPara}
          fora={fora("p34")}
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
        {trilha === "ativacao" ? (
          <>
            <Sec>MEUS PRIMEIROS 90 DIAS</Sec>
            <LinhaCk
              rot="1ª CRE · 3 CREs · 1ª venda"
              val={[s("d90.cre1"), s("d90.cre3"), s("d90.venda1")]
                .map((x) => dataBR(x))
                .join(" · ")}
              ref_="p49"
              irPara={irPara}
            />
          </>
        ) : null}
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
