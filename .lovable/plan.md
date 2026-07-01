## 1. O que já existe (auditoria rápida)

- Auth Supabase + `profiles` + `user_roles` (enum `app_role`) com `has_role` / `has_any_role` / `is_lead_of` / `can_view_sale` como SECURITY DEFINER.
- 15 tabelas com RLS ativo, incluindo `sales`, `sale_documents`, `sale_parties`, `sale_payment`, `sale_bank_accounts`, `sale_comments`, `sale_status_history`, `occurrences`, `occurrence_commissions`, `occurrence_partners`, `activity_logs`, `notifications`, `team_members`.
- Bucket `sale-documents` **privado**, com policies de storage por perfil.
- Wizard de detalhe de venda com save por etapa, checklist, upload de documentos, comentários, histórico, painel de ocorrência com 6 comissões + parceiros.
- Dashboards já diferenciam corretor / gestor / financeiro.
- HIBP desativado a pedido do usuário; auto-confirm de e-mail ativo (ambiente de teste).

## 2. O que será corrigido (segurança / bugs)

- **Auditar cada policy** das 15 tabelas comparando com a matriz de perfis (corretor, coordenador/gestor via `is_lead_of`, jurídico só em status ≥ `aprovada_gestor`, financeiro/admin globais). Corrigir qualquer policy permissiva ou faltante encontrada.
- **Storage `sale-documents`**: garantir que download use sempre `createSignedUrl` (TTL curto, 60s) — remover qualquer `getPublicUrl` que tenha sobrado, e conferir policies por perfil no bucket.
- **Secrets**: verificar que nenhum `service_role`/secret aparece no frontend (`rg` em `src/`). `.env` já ignorado — criar `.env.example` só com nomes.
- **Logs**: remover `console.log` que imprima CPF/RG/conta/documento.
- **Admin de usuários**: proibir auto-alteração de papel (policy + checagem UI) e logar toda mudança em `activity_logs`.

## 3. O que será melhorado (UX / acabamento)

- **Dashboards por perfil** com os KPIs exatos pedidos (listagem acima) — adicionar os que faltam (ex.: "Vendas em jurídico" para corretor, "Comissão por corretor" para financeiro, filas do jurídico).
- **Tela da venda**:
  - Barra de checklist mais visual + lista "o que falta" em português.
  - Banner "Aguardando revisão do gestor / correção do corretor / elaboração do jurídico / ocorrência pendente" com nome do responsável.
  - Esconder botões que o perfil não pode executar; travar edição quando a venda estiver em etapa não pertencente ao usuário.
- **Documentos**: agrupar em Pessoais / Imóvel / Outros; status Pendente / Enviado / Aprovado / Recusado; destacar motivo da recusa; permitir reenvio; gravar em `sale_status_history` + `activity_logs`; disparar `notifications` ao corretor.
- **Ocorrência**: só habilitar em `contrato_assinado`/`ocorrencia_pendente`; pré-preencher a partir da venda; resumo no topo; alerta se soma de comissões > total; modal de conferência antes de concluir; travar edição após concluída; reabertura só para financeiro/admin com justificativa obrigatória (nova coluna `reopen_reason` + log).
- **Notificações**: página `/notificacoes` (não lidas / lidas / marcar como lida / link p/ venda) + sininho no header. Triggers já cobertos por regras de negócio nas ações: enviar-para-revisão, devolver, aprovar-jurídico, recusar-doc, assinar-contrato, ocorrência pendente/concluída.
- **Admin de usuários** (`/admin/usuarios`): lista, papel atual, alterar papel, ativar/desativar (nova flag `profiles.ativo`), vincular corretor a gestor/coordenador via `team_members`.

## 4. Riscos de segurança tratados

- Escalação de privilégio via auto-edição de `user_roles` (policy + UI).
- Acesso cruzado entre corretores por RLS quebrada em `sales` filhas (`sale_*`).
- Vazamento de documentos privados por URL pública.
- Vazamento de PII em logs.
- Exposição de secrets no repositório.
- Bypass de fluxo (ex.: criar ocorrência antes do contrato assinado; editar ocorrência concluída) — reforçado por policies + UI.

## 5. Ordem de implementação

1. **Auditoria RLS + Storage + secrets** (migration corretiva se algo faltar, `.env.example`, limpeza de logs).
2. **Fluxo Documentos** (agrupamento, status, recusa com motivo, notificação, histórico).
3. **Ocorrência endurecida** (gate por status, resumo, alerta de soma, tela de conferência, reabertura com justificativa).
4. **Notificações** (página + sininho + disparos nos pontos do fluxo).
5. **Dashboards completos** por perfil.
6. **Detalhe da venda** — banner de responsável, botões por perfil, checklist visual.
7. **Admin de usuários** (`profiles.ativo`, vínculo, log de mudança de papel).
8. **`docs/TESTE_MANUAL.md`** atualizado com os 18 cenários listados.

Sem remover tabelas nem quebrar o fluxo atual — só migrations aditivas (colunas novas: `profiles.ativo`, `occurrences.reopen_reason`, índices) e ajustes de policies.

Confirma que posso seguir nessa ordem? Se quiser, posso começar direto pelo passo 1 (auditoria + correções de segurança) e te mostrar o diff antes de avançar.