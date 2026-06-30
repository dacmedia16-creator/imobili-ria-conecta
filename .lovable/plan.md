# Plano — Portal Interno da Imobiliária

Sistema web com Lovable Cloud (autenticação, banco, storage privado e RLS por perfil) para corretores cadastrarem vendas, gestores revisarem, jurídico elaborar contrato e financeiro registrar a ocorrência de comissão.

## 1. Estrutura das Telas

**Públicas**
- `/auth` — login e cadastro (email/senha; Google opcional depois)

**Autenticadas (`/_authenticated/*`)**
- `/` — Dashboard adaptado ao perfil (cards de pendências, KPIs, atalhos)
- `/vendas` — lista filtrável (status, corretor, período, busca)
- `/vendas/nova` — wizard de criação (rascunho)
- `/vendas/$id` — detalhe da venda (abas: Dados, Documentos, Histórico, Comentários, Ocorrência)
- `/vendas/$id/editar` — wizard em etapas (mesma estrutura da criação)
- `/vendas/$id/revisar` — tela de revisão (gestor): aprovar/devolver/solicitar doc
- `/vendas/$id/juridico` — painel jurídico (mudança de status, observações internas)
- `/vendas/$id/ocorrencia` — formulário de ocorrência (libera após "Contrato assinado")
- `/notificacoes` — central de notificações internas
- `/admin/usuarios` — gestão de usuários, perfis e vínculos (admin)
- `/admin/equipes` — vínculos corretor ↔ gestor/coordenador (admin)
- `/relatorios` — relatórios financeiros (financeiro/admin)

**Wizard de Nova Venda (10 etapas)** com barra de progresso:
1. Imóvel · 2. Equipe · 3. Vendedores · 4. Compradores · 5. Valores/Negociação · 6. Posse · 7. Comissão · 8. Dados bancários · 9. Documentos · 10. Revisão final

Cada etapa salva parcialmente (autosave do rascunho). Na etapa 10 mostra checklist de pendências antes de habilitar "Enviar ao gestor".

## 2. Estrutura das Tabelas

**Perfis e acesso**
- `profiles` (id=auth.uid, nome, email, telefone, ativo)
- `app_role` enum: `corretor | coordenador | gestor | juridico | financeiro | admin`
- `user_roles` (user_id, role) — papéis separados do profile (segurança)
- `team_members` (membro_id, lider_id, tipo) — vínculo corretor → coordenador/gestor

**Venda e relacionados**
- `sales` — campos principais do imóvel, equipe, valores, posse, comissão, status, corretor_id, coordenador_id, created_at/updated_at
- `sale_parties` (sale_id, papel: vendedor1/vendedor2/comprador1/comprador2, nome, rg, cpf_cnpj, profissao, email, telefone)
- `sale_payment` (sale_id, forma_pagamento, entrada_valor/data, parcela1, parcela2, fgts_*, financiamento_*, observacoes)
- `sale_bank_accounts` (sale_id, titular, banco, agencia, conta, pix)
- `sale_documents` (sale_id, tipo, storage_path, uploaded_by, status: pendente/enviado/aprovado/recusado, motivo_recusa, versao)
- `sale_comments` (sale_id, autor_id, escopo: revisao/juridico/interno, texto, doc_id opcional)
- `sale_status_history` (sale_id, de, para, autor_id, motivo, created_at)

**Ocorrência e comissões**
- `occurrences` (sale_id unique, codigo_imovel, tempo_venda, data_assinatura, nota_fiscal_obrigatoria, midia, financiamento_*, previsao_recebimento_*, observacoes, status)
- `occurrence_commissions` (occurrence_id, papel: corretor_captador / indicador_captador / coordenador_captador / corretor_vendedor / indicador_vendedor / coordenador_vendedor, nome, percentual, valor)
- `occurrence_partners` (occurrence_id, nome, cpf_cnpj, percentual, valor, banco, agencia, conta)

**Suporte**
- `notifications` (user_id, sale_id, tipo, titulo, mensagem, lida, created_at)
- `activity_logs` (autor_id, sale_id, acao, payload jsonb, created_at)

**Storage**
- Bucket privado `sale-documents`, path `sale_id/tipo/uuid.ext`. Acesso só por signed URLs geradas no servidor.

## 3. Regras de Permissão (RLS via `has_role` + vínculos)

- **Corretor**: SELECT/UPDATE em `sales` onde `corretor_id = auth.uid()` e status ∈ {rascunho, devolvida}. INSERT livre. Documentos: pode subir/ver/refazer apenas das próprias vendas.
- **Coordenador/Gestor**: SELECT em vendas cujo `corretor_id` esteja em `team_members` sob ele. UPDATE de status apenas para "aprovada"/"devolvida". Pode comentar e recusar documentos.
- **Jurídico**: SELECT em vendas com status ≥ "aprovada pelo gestor". UPDATE de status entre os estados jurídicos. Pode adicionar observações internas.
- **Financeiro**: SELECT em tudo; INSERT/UPDATE em `occurrences` e `occurrence_commissions`.
- **Admin**: acesso total + gestão de `user_roles` e `team_members`.
- Função `SECURITY DEFINER` `has_role(uid, role)` + `is_team_lead_of(lead, member)` para evitar recursão.
- Storage: políticas em `storage.objects` espelham as de `sale_documents` (acesso via path prefix = sale_id).
- Nunca expor URL pública: download sempre via server function que gera signed URL curta.

## 4. Fluxo de Status

```
rascunho
  └─ (corretor envia) → enviada_revisao
       ├─ (gestor devolve)  → devolvida_ajuste → (corretor reenvia) → enviada_revisao
       └─ (gestor aprova)   → aprovada_gestor → enviada_juridico
                                  └─ em_elaboracao_contrato
                                       └─ aguardando_assinatura
                                            ├─ devolvida_ajuste (jurídico)
                                            └─ contrato_assinado
                                                 └─ ocorrencia_pendente
                                                      └─ ocorrencia_concluida
arquivada / cancelada (qualquer ponto, admin)
```
Cada transição grava em `sale_status_history` + dispara notificação para os papéis envolvidos.

## 5. Escopo por Fase

**v1 (entrega inicial — implementaremos agora, em ordem)**
1. Auth (email/senha) + tabela `profiles` + trigger de criação
2. Enum de papéis, `user_roles`, `team_members`, `has_role`
3. Layout autenticado, dashboard básico por perfil, menu
4. Tabelas de vendas, partes, pagamento, banco + wizard de Nova Venda com autosave
5. Upload de documentos com bucket privado, signed URLs, status por documento
6. Painel do gestor: revisar, aprovar, devolver com comentário obrigatório, recusar documento
7. Painel do jurídico: mudança de status, observações internas
8. Ocorrência de compra e venda: formulário, cálculo automático de comissões, validação de soma, página de resumo para conferência
9. Notificações internas (sino + página) e histórico/log
10. Tela admin de usuários, papéis e vínculos de equipe

**Fora da v1 (preparado, não exigido)**
- Envio de e-mail (estrutura no banco e enum de notificação prontos)
- Exportar ocorrência em PDF (v1 entrega visualização limpa imprimível)
- Relatórios avançados (v1 entrega lista filtrável + KPIs)
- Login Google/SSO

## Detalhes Técnicos

- Stack: TanStack Start + Lovable Cloud (Supabase gerenciado). RLS em todas as tabelas, GRANTs explícitos.
- Validação: Zod no cliente e em todos os `createServerFn`.
- Mutations sensíveis (mudança de status, aprovação, ocorrência) feitas em server functions com `requireSupabaseAuth` + checagem de papel via `has_role`.
- Upload via signed upload URL; leitura via signed URL curta (5 min) gerada server-side.
- Cálculos de comissão no cliente (UX) e revalidados no servidor antes de persistir.
- UI: shadcn/ui, badges de status com cores semânticas, barra de progresso no wizard, banners de pendência.

Confirme se posso seguir com essa estrutura (ou indique ajustes: papéis adicionais, campos extras, escopo da v1) que parto para a implementação na ordem acima.
