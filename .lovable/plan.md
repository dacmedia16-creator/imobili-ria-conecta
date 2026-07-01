# Continuação do Sistema Imobiliário — Plano de Implementação

## 1. O que já existe

**Backend (13 tabelas + storage privado)**
- `profiles`, `user_roles` (enum `app_role`), `team_members` com funções `has_role`, `has_any_role`, `is_lead_of`, `can_view_sale`.
- `sales` (26 colunas), `sale_parties`, `sale_payment`, `sale_bank_accounts`, `sale_documents`, `sale_comments`, `sale_status_history`.
- `occurrences` (23 colunas — já cobre todos os campos pedidos), `occurrence_commissions` (papel, nome, %, valor), `occurrence_partners` (nome, CPF/CNPJ, %, valor, banco, agência, conta).
- `activity_logs`, `notifications`.
- Bucket privado `sale-documents` com policies por venda.
- Trigger `handle_new_user` cria perfil e role `corretor` no signup.

**Frontend**
- Auth (`/auth`) + contexto `useAuth` com roles.
- AppShell com sidebar adaptativa por perfil.
- `/dashboard` (KPIs básicos), `/vendas` (lista filtrável), `/vendas/nova`, `/vendas/$id` com 8 abas (Dados, Partes, Pagamento, Bancário, Documentos, Comentários, Histórico, Ocorrência stub).
- `/admin/usuarios` com toggle de roles e vínculo de líderes.
- Botões de transição de status (rascunho → revisão → jurídico → contrato → ocorrência) já esboçados no cabeçalho da venda.

## 2. O que será reaproveitado (não mexer)

- Todo o schema atual — as tabelas `occurrences`, `occurrence_commissions`, `occurrence_partners` **já batem com os campos pedidos**.
- Bucket e policies de storage.
- `useAuth`, `AppShell`, `StatusBadge`, `DOC_TYPES`, `STATUS_LABEL`.
- Estrutura das rotas `_authenticated/*` (gate gerenciado).
- Botões de status já existentes em `vendas.$id.tsx` — vão ser expandidos, não reescritos.

## 3. O que será criado / alterado

### 3.1 Segurança (auditoria antes de novas features)
- Rodar `supabase--linter` e revisar RLS de cada tabela pública.
- Confirmar que toda escrita em `sales`/`sale_*` passa por `can_view_sale` ou role check.
- Confirmar `sale-documents` bucket: `SELECT/INSERT/UPDATE/DELETE` restritos a quem tem `can_view_sale(sale_id)`.
- Confirmar `.env` no `.gitignore` (só variáveis `VITE_*` públicas — service role nunca no frontend).
- Nenhum uso de `supabaseAdmin` em componente/loader (checar `rg`).
- Gerar relatório resumido com pendências encontradas.

### 3.2 Migração pequena (apenas se faltar algo)
- Adicionar coluna `sales.ocorrencia_id` (uuid nullable) para atalho — **opcional**, só se ajudar a query do dashboard.
- Adicionar índice em `sales(corretor_id, status)` e `occurrences(sale_id)` se ausentes.
- Ajustar policy de `notifications` para permitir INSERT via qualquer usuário autenticado que tenha `can_view_sale`.
- Nenhuma tabela nova; nenhuma tabela removida.

### 3.3 Tela de Ocorrência completa
Substituir o stub `OccurrencePanel` por componente com:
- **Pré-preenchimento** ao criar: pega `sales` + `sale_parties` + `sale_payment` e faz `insert` em `occurrences` com defaults (código imóvel, valor anunciado/negociado, %, valor comissão, financiamento).
- Form editável com todos os 20 campos da tabela.
- Sub-seção **Comissões** (repeater com 6 papéis pré-definidos: captador, indicador captador, coordenador captador, vendedor, indicador vendedor, coordenador vendedor). Cálculo % ↔ valor em ambos sentidos; alerta se soma > `valor_comissao`.
- Sub-seção **Parcerias** (repeater livre).
- Botões **Salvar rascunho**, **Finalizar ocorrência** (muda venda para `ocorrencia_concluida`, cria log e histórico), **Reabrir** (financeiro/admin, com motivo obrigatório).
- Guarda de permissão: escrita só para `financeiro`/`admin`/`gestor`/`coordenador` (já garantido no RLS).

### 3.4 Fluxo de status expandido
Em `vendas.$id.tsx`, expandir a barra de botões:
- **Corretor**: Enviar para revisão, Corrigir e reenviar (após devolvida), Reenviar documento (por card).
- **Gestor/Coordenador**: Aprovar p/ jurídico, Devolver com motivo obrigatório (modal), Solicitar documento adicional (cria comentário escopo `documento`), Abrir ocorrência quando contrato assinado.
- **Jurídico**: Em elaboração, Aguardando assinatura, Contrato assinado, Devolver ao gestor com motivo.
- **Financeiro/Admin**: Abrir/Editar/Finalizar/Reabrir ocorrência.
- Trigger client-side: ao marcar `contrato_assinado`, automaticamente muda para `ocorrencia_pendente` e cria `notifications` para financeiro (query em `user_roles` para achar destinatários).
- Toda transição grava em `activity_logs` (tipo + `sale_id` + payload).

### 3.5 UX do corretor — "envio para revisão"
- Função `validateReadyToSubmit(sale)` retornando lista de pendências em português: "Falta preencher comprador", "Falta enviar RG", etc.
- Botão "Enviar para revisão" abre `Dialog` de conferência com checklist verde/vermelho.
- Bloqueia envio se pendências críticas (imóvel, 1 vendedor completo, 1 comprador completo, valor negociado, forma pagamento, % ou valor comissão, docs obrigatórios: RG+CPF+matrícula).
- Progress bar já existe — passa a refletir a validação real (não só count de campos).

### 3.6 Dashboards por perfil
Refatorar `dashboard.tsx` em blocos condicionais por `hasAny(...)`:
- **Corretor**: Minhas vendas / Pendências (rascunho + devolvida) / Em jurídico / Contratos assinados.
- **Gestor**: Aguardando revisão / Devolvidas / No jurídico / Ocorrências pendentes (da equipe via `is_lead_of`).
- **Jurídico**: Aprovadas p/ jurídico / Em elaboração / Aguardando assinatura / Assinadas.
- **Financeiro/Admin**: Ocorrências pendentes / Concluídas / Comissão prevista (soma) / Comissão por corretor (agrupamento) / Comissão por período (últimos 30 dias).
- Cada card é um link para `/vendas?status=...`.

### 3.7 Checklist de testes (entrega final)
Arquivo `docs/TESTE_MANUAL.md` com 10 cenários prontos para clicar, incluindo os de RLS negativa (logar como corretor B e tentar ver venda do corretor A).

## 4. Riscos de segurança revisados

1. **RLS em todas as tabelas públicas** — rodar linter e listar `pg_policies`.
2. **Escalada de privilégio** — confirmar que `user_roles` só é gravável por admin (policy atual: revisar).
3. **Isolamento por equipe** — `can_view_sale` já contempla `is_lead_of`; validar com teste manual.
4. **Storage privado** — Signed URLs curtas (60s) para download; nenhum path público.
5. **Service role nunca no cliente** — `.env` só com `VITE_*`.
6. **Escrita cruzada em `occurrences`** — reforçar policy para exigir `can_view_sale(sale_id)` também em INSERT.
7. **Notificações** — INSERT restrito a usuários que visualizam a venda para evitar spam.
8. **Documentos** — moderação (aprovar/recusar) limitada a gestor/jurídico via role check.

## 5. Ordem de implementação

1. **Auditoria de segurança** (linter + revisão policies + relatório). Micro-migração corrigindo qualquer buraco encontrado.
2. **Validação "pronto para revisão"** + modal de conferência do corretor.
3. **Botões de fluxo por perfil** (expandir header e automatizar `contrato_assinado → ocorrencia_pendente + notificações`).
4. **Tela de Ocorrência completa** (form + comissões + parcerias + finalizar/reabrir).
5. **Dashboards por perfil** (cards e agregações).
6. **Log de atividade** em todas as transições e ações críticas.
7. **`docs/TESTE_MANUAL.md`** com o roteiro dos 10 cenários.

Sem tabelas removidas, sem fluxo simplificado, sem quebra do que já roda. Aprovando este plano, começo pela etapa 1.
