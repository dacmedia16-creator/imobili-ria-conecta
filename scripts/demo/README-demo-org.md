# Imobiliária de demonstração (ZZ Teste Provisionamento) — FASE 1 (t_c6ebfd05, 06/11/2026)

Nada foi gravado em produção. Tudo abaixo foi levantado por leitura (endpoint read-only) ou por simulação desfeita (`raise`).

## 1. Única Escolha — só números agregados
- 158 ativos (32 inativos). Papéis ativos: 129 corretores, 18 gestores, 10 team leaders, 8 admin, 2 super_admin, 7 staff, 3 jurídico, 2 financeiro, 2 lançamento, 1 fotógrafo.
- 18 equipes (sem sub-equipe), 120 membros, 11 líderes auxiliares.
- Vendas válidas por mês (o ADM só tem histórico desde ago/2026): ago 37 / R$ 11,1 mi; set 57 / R$ 27,0 mi; out 43 / R$ 21,7 mi. Ticket médio R$ 300–505 mil, comissão média 5,5–5,8%.
- 64 vendedores com venda; top 5 = 28% do VGV, top 10 = 44%; 1 campeão com 16 vendas, metade com 1 venda.
- Captações: 211 no total, 21 aprovadas (assinadas); assinadas por mês: 3 a 12. Comissão: vendedor ~25%, captador ~22%, líderes ~7,5% cada.
- Reservas: 530 em 90 dias, 7 salas.

## 2. Mapa do que popular (tabela → depende de)
| Tela | Tabelas | Depende de |
|---|---|---|
| Usuários/papéis | auth.users (+identities) → `handle_new_user` cria organization_members, profiles, user_roles(corretor) | app_metadata.organization_id = ZZ |
| Equipes | teams, team_members (+team_membership_history por gatilho) | líder com papel gestor/team_leader; 1 equipe por pessoa |
| Vendas | sales, sale_parties, sale_status_history (o mês conta pelo evento `contrato_assinado`) | usuários |
| Comissões/Financeiro | occurrences, occurrence_commissions (venda_distribuicao por gatilho) | venda em ocorrencia_* com previsão de recebimento completa |
| Captações | exclusive_units (modelo remax-padrao), exclusive_captures (status aprovada + signed_on) | módulo captacao_exclusiva |
| Feedback | módulo feedback_proprietario; números vêm do XML (ZZ já tem 375 anúncios XML) | captações aprovadas |
| Metas | metas (mês), minhas_metas (ano) | usuários |
| Minha Carreira / ranking | lido de vendas+captações; mural: achievement_posts por gatilho | módulos captacao_exclusiva, mural_conquistas, ranking_valores |
| Reserva de salas | agency_rooms, room_reservations | módulo reserva_salas |
| Fotos/vouchers | módulo vouchers_fotos — **fica desligado** (gera vouchers e avisos) | — |
| Leads | já existem 92 (teste da Nicole) | ver risco 1 |

## 3. Riscos e como evitar
1. **Leads/Nicole (o maior)**: a ZZ é a org de teste da Nicole (módulo leads ligado, rodízio entre corretores ativos, 23 leads abertos). Corretores fictícios entrariam no rodízio e o job `leads-prazos` (5 min) redistribuiria leads para eles. **Decidido por Denis em 06/11 (opção 2):** desligar leads na ZZ. Isso é o PASSO 1 da carga. Além disso, a migration `20261106200000_leads_rodizio_ignora_demo.sql` tira os ids `de30de30-` do rodízio e de "pode ser responsável", e vale mesmo se os leads forem religados. Sem essa migration, a carga aborta. Os 23 leads existentes não são apagados nem reatribuídos. A limpeza NÃO religa os leads; para isso há um comando à parte (`--religar-leads-sql`).
2. **Robô dos satélites (Visita/Estudo/60 Dias)**: `sync_org_map.mode = off` para a ZZ → o robô descarta a fila dela. Mesmo assim o script grava `sync_exclusoes` para cada fictício e aborta se o mode não for `off`.
3. **E-mail de boas-vindas** (live): cada perfil novo entra na `email_outbox`. O script cancela essas linhas na mesma transação (o envio só sai 2 min depois do commit) e o domínio `.invalid` não existe.
4. **WhatsApp (ZionTalk)**: vendas (avisos por status), captações, Clicksign, lembrete de sala (5 min), vencimento de exclusividade (segunda 8h), fotos. Bloqueio: `notificar_whatsapp=false`, telefones 90000-XXXX, nenhum envelope Clicksign, lembretes de reservas futuras já marcados como enviados, módulo vouchers_fotos desligado. A carga é SQL direto: as notificações de venda (server functions) não rodam.
5. **Sininho**: gatilhos de banco que criam notificação só por Clicksign/leads — não acionados.
6. **Mural/ranking**: o gatilho cria posts do Mural só dentro da ZZ (módulo ligado). Desejado.
7. **Isolamento**: rankings, painéis e relatórios filtram por `current_org_id()`/RLS; a função de corretores ativos (definer) devolveu só a org do usuário (simulado: 158 = Única). Estudo de Mercado só recebe vendas de quem tem chave (`estudo_vendas_api_keys`: ZZ = 0). O Painel da Plataforma só soma "membros" das imobiliárias (vai aparecer +120 na contagem total de membros — informar Denis).

## 4/5. Scripts
- `seed-demo-org.py` — dry-run (padrão), `--sql` (carga, 1 transação, idempotente por ids determinísticos), `--cleanup-sql` (limpeza só da marca `de30de30-…` + `@demo.invalid`).
- "Entrar como" exige: perfil ativo na org, papel ≠ super_admin, conta no Auth com e-mail. O script cria a conta no Auth **sem senha** (`encrypted_password` vazio), só para o link gerado no servidor.

## Ensaio local (06/11): feito, resultado em `ensaio/ensaio-resultado.txt`
Postgres 17 da Supabase, num container descartável sem rede. O schema foi restaurado do backup de 05/11, só a estrutura; o auth tem os 3 gatilhos iguais aos de produção; a fixture é fictícia (ZZ com leads ligado, 23 leads abertos e outra org). Para repetir: `bash scripts/demo/ensaio/run.sh`.
1. Carga sem a trava do rodízio: abortou e não gravou nada.
2. Migration + carga em 29 s: 120 no Auth (0 com senha, 100% `@demo.invalid`), 19 equipes, 725 vendas (VGV fechado de R$ 311.996.000), 686 ocorrências, 2.744 comissões, 363 captações, 768 metas, 799 reservas (0 futuras sem lembrete marcado), 695 posts no Mural. Zero e-mail pendente, zero fila de sync, zero Clicksign, zero voucher, zero notificação. A outra org não foi tocada.
3. Segunda rodada: nada mudou (idempotente).
4. Leads desligado: o job de prazos não mexeu em nenhum lead (md5 igual).
5. Leads religado (simulado e desfeito): o rodízio só escolhe os reais; quando eles são excluídos, o lead vai para o banco. Nenhum fictício pode ser responsável e nenhum lead foi parar com um fictício.
6. Limpeza: tudo volta ao estado anterior, menos os módulos (leads continua desligado, de propósito, e os módulos da demo continuam ligados).
7. O comando à parte religa os leads.
Ainda não testado no local: o "Entrar como" de verdade, que gera o link no servidor do GoTrue. Fica para conferir na FASE 2, com um único usuário.
