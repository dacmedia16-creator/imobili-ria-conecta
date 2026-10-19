# Inventário — datas sem legenda no ADM MAX (t_c6e23001, parte 1-B)

Pedido de Denis (19/10/2026): "quando mostrar uma data no sistema ter a legenda do que seria aquela data"
— vale para o sistema todo. Levantamento SOMENTE LEITURA sobre o commit 7fcc7a5 (main).
Nada aqui foi alterado; a aplicação das legendas é a parte 2.

Legenda das colunas:
- Status: SEM = data solta, sem texto que diga o que é; VAGA = rótulo genérico ("Data", "Venda", "Prazo");
  PARCIAL = o rótulo existe em um lugar (ex.: tabela), mas falta em outro (ex.: cartão do celular).
- ⚠ AMBÍGUA = o mesmo campo mostra coisas diferentes conforme o caso, sem avisar qual.

## Datas ambíguas (prioridade)

| # | Onde | Campo | Por que é ambígua | Sugestão |
|---|------|-------|-------------------|----------|
| A1 | Vendas (lista) — `vendas.index.tsx` | `data_venda` | Última assinatura OU, se não assinada, a criação. | ✅ Resolvido na parte 1-A: "Criada em" + "Assinada em"/"Ainda não assinada". |
| A2 | Dashboard → vendas recentes — `src/routes/_authenticated/dashboard.tsx:627` + `src/lib/dashboard-datas-recentes.ts:51` | `data_venda` | Mesmo problema de A1 e o texto é só "Data: dd/mm/aaaa". | Usar o mesmo componente da lista: "Criada em … / Assinada em …" (ou "Ainda não assinada"). |
| A3 | Ficha da ocorrência (tela e impressão) — `src/components/vendas/OccurrenceReportBody.tsx:158` | `dataAssinaturaOficial ?? occ.data_assinatura` | Cabeçalho "Data de assinatura" mostra a data oficial (último contrato assinado) ou, sem ela, a data digitada na ocorrência. | Manter "Data de assinatura" e, quando vier da ocorrência, acrescentar "(informada na ocorrência)". |
| A4 | Documento assinado da captação — `src/components/exclusividades/DocumentoAssinadoResumo.tsx:47` | `closed_at` ou `anexadoEm` | Já troca o rótulo ("Todos assinaram em" / "Anexado em"). | OK — só registrar como modelo a seguir. |
| A5 | Produção por pessoa — `src/components/producao-por-pessoa/DetailTable.tsx:92` e `:155` | `concluida_em` (= `venda_em`) | Tabela diz "Data da venda", mas o valor é a data da assinatura (Lançamento: entrada no Financeiro). No celular não há rótulo. | "Assinada em dd/mm/aaaa" (Lançamento: "Efetivada em"). |

## Vendas

| # | Arquivo:linha | Tela / onde aparece | Campo | O que a data significa | Rótulo atual | Status | Legenda sugerida |
|---|---|---|---|---|---|---|---|
| V1 | `src/routes/_authenticated/vendas.$id.tsx:4647` | Detalhe da venda → Histórico de status | `sale_status_history.created_at` | Quando a venda mudou de etapa | nenhum (só "De → Para") | SEM | "Mudou em dd/mm/aaaa hh:mm" |
| V2 | `src/routes/_authenticated/vendas.$id.tsx:4720` | Detalhe da venda → Atividade | `sale_activity.created_at` | Quando a ação foi registrada | nenhum | SEM | "Registrado em dd/mm/aaaa hh:mm" |
| V3 | `src/routes/_authenticated/vendas.$id.tsx:5087` | Revisão da venda → grupo Histórico | `sale_status_history.created_at` | Mudança de etapa | rótulo é a transição | SEM | "Mudou em …" |
| V4 | `src/routes/_authenticated/vendas.$id.tsx:6512` | Aba Histórico (venda padrão) | `sale_status_history.created_at` | Mudança de etapa | nenhum | SEM | "Mudou em …" |
| V5 | `src/routes/_authenticated/vendas.$id.tsx:6622` | Comentários da venda | `sale_comments.created_at` | Quando o comentário foi escrito | nenhum (só o escopo) | SEM | "Comentado em …" |
| V6 | `src/routes/_authenticated/vendas.$id.tsx:4835` | Revisão → "Previsão de recebimento — Nª parcela" | `prev_recebimentoN_data` | Data prevista de pagamento da parcela | rótulo do grupo; data vem após "—" | VAGA | "… — previsto para dd/mm/aaaa" |
| V7 | `src/components/vendas/LancamentoDetail.tsx:2060` | Lançamento → Histórico | `sale_status_history.created_at` | Mudança de etapa | nenhum | SEM | "Mudou em …" |
| V8 | `src/components/vendas/LancamentoDetail.tsx:2079` | Lançamento → Atividade | `activity.created_at` | Quando a ação foi registrada | nenhum | SEM | "Registrado em …" |
| V9 | `src/components/vendas/ClicksignVenda.tsx:261` | Venda → bloco Clicksign (assinado) | `closed_at` | Quando o último signatário assinou | "· dd/mm hh:mm" após a origem | SEM | "· todos assinaram em …" |
| V10 | `src/components/vendas/PartiesStep.tsx:576` | Nova venda → cliente já cadastrado → histórico | `cliente_historico.data` | Mês/ano da venda anterior do cliente | nenhum ("out. de 2026") | SEM | "em out/2026" → "Comprou em out/2026" |
| V11 | `src/components/vendas/OccurrenceReportBody.tsx:362/370/378` | Ficha da ocorrência → Previsão de recebimento | `prev_recebimentoN_data` | Data prevista de cada parcela | cabeçalho "Data" | VAGA | "Data prevista" |
| V12 | `src/routes/_authenticated/notificacoes.tsx:131` | Notificações | `notifications.created_at` | Quando o aviso foi gerado | nenhum | SEM | "Recebida em dd/mm/aaaa hh:mm" |
| V13 | `src/components/AgingBadge.tsx` (usado em vendas.index e dashboard) | Selo "há X dias" | última troca de status / criação | Tempo na etapa atual | cabeçalho "Nesta etapa" só na tabela; cartão sem rótulo | PARCIAL | "Nesta etapa há X dias" no cartão |
| — | `vendas.$id.tsx:4306` "Criada em", `vendas.$id.tsx:4885/4994`, `FichaImovelFields.tsx:222`, `ocorrencias-concluidas.tsx:411/474`, `vendas-por-regiao.tsx:223/473` | — | — | — | rótulo claro | OK | — |

## Captações / Exclusividades

| # | Arquivo:linha | Tela / onde aparece | Campo | O que a data significa | Rótulo atual | Status | Legenda sugerida |
|---|---|---|---|---|---|---|---|
| C1 | `src/routes/_authenticated/exclusividades.$id.tsx:1956` | Captação → Histórico | `capture_history.created_at` | Quando a ação aconteceu | nenhum ("dd/mm/aaaa hh:mm · ação · autor") | SEM | "Em dd/mm/aaaa hh:mm · …" |
| C2 | `src/components/exclusividades/PorCorretorTab.tsx:404-432` | Exclusividades → Por corretor | `validity.start` / `validity.end` | Assinatura e vencimento da exclusividade | cabeçalhos "Início" / "Fim" | VAGA | "Assinada em" / "Vence em" |
| C3 | `src/components/exclusividades/PendenciasFeedback.tsx:87/96` | Pendências de feedback | `aprovada_em` | Quando o gestor aprovou a captação | cabeçalho "Aprovada" | VAGA | "Aprovada em" |
| C4 | `src/components/exclusividades/PendenciasFeedback.tsx:173/182` | Pendências de feedback | `prazo` | Data limite para enviar o feedback | cabeçalho "Prazo" | VAGA | "Prazo do feedback" / "Enviar até" |
| C5 | `src/components/exclusividades/AnuncioPortais.tsx:257` | Anúncio nos portais → resultado da busca | `seen.collected_on` | Dia da coleta dos portais | data no meio da frase, sem "coleta de" | VAGA | "Visto na coleta de dd/mm/aaaa em …" |
| C6 | `src/components/exclusividades/PlanoChecklist.tsx:158` | Plano da captação | `prazo` | Data limite do item | "prazo dd/mm" | VAGA | "Fazer até dd/mm/aaaa" |
| — | `exclusividades.$id.tsx:959/985/986/2063`, `exclusividades.painel.tsx:415`, `VigenciaBar.tsx:45/64/65`, `CapturesMap.tsx:58`, `AnuncioPortais.tsx:112/120/121/249/273/295`, `SugestoesSite.tsx:42`, `PlanoChecklist.tsx:164`, `captacoes-painel.ts:147`, `exclusive-captures.ts:794/796`, `exclusive-expiry-alerts.server.ts:39/42`, `DocumentoAssinadoResumo.tsx:46` | — | — | — | rótulo claro | OK | — |
| C7 | `src/routes/_authenticated/feedback.tsx:556` (`src/lib/feedback-captacao.ts`) | Feedback ao proprietário → Próximos passos | `prazo` do item | Data prevista do próximo passo | "(08/11)" sem verbo | VAGA | "(previsto para 08/11)" |

Observação: `src/lib/captacao-auditoria.ts:50` (`quando`) aparece em `exclusividades.$id.tsx:1020` como "Devolvida para ajuste por X em dd/mm/aaaa" — OK.

## Financeiro / Relatórios / Dashboard

| # | Arquivo:linha | Tela / onde aparece | Campo | O que a data significa | Rótulo atual | Status | Legenda sugerida |
|---|---|---|---|---|---|---|---|
| F1 | `src/routes/_authenticated/dashboard.tsx:627` | Dashboard → vendas recentes | `data_venda` | ⚠ ver A2 | "Data:" | VAGA + AMBÍGUA | "Criada em / Assinada em" |
| F2 | `src/routes/_authenticated/relatorios.tsx:804/834` | Relatórios → Recebimentos (tabela) | `parcela.data` | Data prevista da parcela | cabeçalho "Data" | VAGA | "Data prevista" |
| F3 | `src/routes/_authenticated/relatorios.tsx:906` | Relatórios → Recebimentos (cartão celular) | `parcela.data` | Data prevista da parcela | "Data" | VAGA | "Data prevista" |
| F4 | `src/routes/_authenticated/relatorios.tsx:1119/1148` | Relatórios → Comissões calculadas | `venda_em` oficial | Data da assinatura (Lançamento: efetivação) | "Venda comercial" | VAGA | "Assinada em" |
| F5 | `src/routes/_authenticated/relatorios.tsx:1422/1444` | Relatórios → vendas paradas/atualizadas | `sales.updated_at` | Última alteração da venda | "Atualizado em" | OK (confirmar se é o que Denis quer ver) | — |
| F6 | `src/components/comparativo-comissao/DetailTable.tsx:103` | Comparativo de comissão (cartão celular) | `data_fechamento` | Data da assinatura/efetivação | nenhum | PARCIAL (tabela diz "Efetivação") | "Efetivada em dd/mm/aaaa" |
| F7 | `src/components/producao-por-pessoa/DetailTable.tsx:92` | Produção por pessoa (cartão celular) | `concluida_em` | ⚠ ver A5 | nenhum | SEM | "Assinada em …" |
| F8 | `src/components/producao-por-pessoa/DetailTable.tsx:119/155` | Produção por pessoa (tabela) | `concluida_em` | ⚠ ver A5 | "Data da venda" | VAGA | "Assinada em" |
| F9 | `src/components/financeiro/ComissoesCalculadasTable.tsx:145/162/190` | Financeiro → Comissões calculadas | `dataEfetivacao` | Data em que a venda foi efetivada | "Efetivação" | VAGA (leve) | "Efetivada em" |
| F10 | `src/routes/_authenticated/visao-executiva.tsx:1171/1197` | Visão executiva → vendas do período | `fechado_em` | Data da assinatura/efetivação | "Fechou em" | OK (padronizar com "Assinada em") | — |
| — | `comissoes-a-receber.tsx:607/608/699/701`, `RecebimentosTable.tsx:46/51/138/144`, `AgingPanel.tsx:67`, `relatorios.tsx:840/911`, `relatorios.tsx:1287/1321` | — | — | — | rótulo claro | OK | — |

## Minha carreira / Mural / Oportunidades

| # | Arquivo:linha | Tela / onde aparece | Campo | O que a data significa | Rótulo atual | Status | Legenda sugerida |
|---|---|---|---|---|---|---|---|
| M1 | `src/components/minha-carreira/MeuDinheiro.tsx:107/115` | Minha carreira → Meu dinheiro | `venda_em` | Data da assinatura da venda | cabeçalho "Venda" | VAGA | "Assinada em" |
| M2 | `src/components/minha-carreira/Conquistas.tsx:191` | Minha carreira → Conquistas | `venda_em` | Data da assinatura | nenhum ("dd/mm/aaaa · N parabéns") | SEM | "Vendida em dd/mm/aaaa" |
| M3 | `src/components/mural/MuralConquistasView.tsx:89` (`src/lib/mural-conquistas.ts:87`) | Mural de conquistas | `venda_em` | Data da assinatura | nenhum | SEM | "Vendida em dd/mm/aaaa" |
| M4 | `src/components/oportunidades/MuralPostCard.tsx:40` (`src/lib/oportunidades-mural.ts:47`) | Oportunidades → mural | `posted_at` | Quando o pedido foi publicado | só o ícone 📅 | SEM | "📅 publicado em dd/mm" |
| M5 | `src/components/minha-carreira/Diario.tsx:202` | Diário → lista de dias | `dia` | Dia das atividades | nenhum (título da linha) | OK (contexto é óbvio: é o dia) | — |
| — | `Diario.tsx:300/311` "Último registro", `feedback.tsx:733` "feito em" | — | — | — | rótulo claro | OK | — |

## Plataforma / Admin / Outros

| # | Arquivo:linha | Tela / onde aparece | Campo | O que a data significa | Rótulo atual | Status | Legenda sugerida |
|---|---|---|---|---|---|---|---|
| P1 | `src/components/ChamadoDetalhe.tsx:188` | Chamados → mensagens | `mensagens.created_at` | Quando a mensagem foi enviada | nenhum ("autor · dd/mm/aaaa hh:mm") | SEM | "autor · enviada em …" |
| P2 | `src/components/AppShell.tsx:490` | Faixa de "visão da plataforma" | `expiresAt` | Hora em que o acesso de suporte expira | "(até hh:mm)" | VAGA (leve) | "(acesso expira às hh:mm)" |
| P3 | `src/routes/conta-max.tsx:44` | Conta MAX → erro | `failure.at` | Hora do erro | "Horário:" | OK | — |
| — | `plataforma.usuarios.tsx:363/85` "Último acesso", `admin.posicionamento.tsx:123` "Sugerido por … em", `reservas-salas.tsx:416/586` "bloqueado até", `reservas-salas.tsx:129-138` (dias da reserva no formulário) | — | — | — | rótulo claro | OK | — |

## Parte 2 aplicada (t_b956a455) — só texto na tela

- Vendas: V1–V13, A2 (Dashboard "Criada em"/"Assinada em"/"Ainda não assinada"), A3 ("(informada na ocorrência)").
- Captações: C1 "Em …", C2 "Assinada em"/"Vence em", C3 "Aprovada em", C4 "Enviar até", C6 "fazer até", C7 "previsto para". C5 mantido ("apareceu na coleta de …" já é claro).
- Financeiro/Relatórios: F2/F3 "Data prevista", F4 "Assinada em", F6/F9 "Efetivada em", A5/F7/F8 "Assinada em" (Lançamento: "Efetivada em"), F10 "Assinada em". F5 mantido.
- Minha carreira/Mural: M1–M3 "Assinada em", M4 "📅 publicado em".
- Plataforma: P1 "enviada em", P2 "acesso expira às".
- Prints (maquete, CSS real do build, dados fictícios): `docs/prints/t_b956a455/`.

## Resumo para a parte 2

- 5 datas ambíguas (A1 resolvida; A2, A3, A5 a corrigir; A4 já é modelo).
- ~30 pontos SEM/VAGA/PARCIAL. Os mais vistos no dia a dia: Dashboard (A2), históricos/atividades da venda (V1–V8), notificações (V12), Relatórios → Recebimentos "Data" (F2/F3), Produção por pessoa (A5), Meu dinheiro/Conquistas/Mural (M1–M3).
- Sugestão de padrão único de verbos: "Criada em", "Assinada em", "Efetivada em" (Lançamento), "Previsto para"/"Data prevista", "Recebido em", "Mudou em" (histórico), "Registrado em" (atividade), "Vence em", "Publicado em".
- Reaproveitar `src/lib/vendas-lista-datas.ts` (`formatarDataBR`, `datasDaVendaNaLista`) e o componente da lista para A2.
- PDFs/WhatsApp: `owner-feedback-pdf.ts:138` ("emitido em"), `exclusive-expiry-alerts.server.ts`, `room-reservation-reminders.ts:31` já usam frase com verbo — conferir texto final na parte 2.
