## Objetivo
Reorganizar os papéis do sistema conforme a nova regra: **corretor, gestor, jurídico, financeiro, admin, super_admin** — removendo `coordenador`, adicionando `super_admin`, e implementando a **trava do financeiro** após aceite.

---

## 1. Papéis (banco de dados)

Migração no enum `app_role`:
- Adicionar `super_admin`.
- Remover `coordenador` (após migrar quem tiver esse papel para `gestor`).

Reescrever funções que citam `coordenador`:
- `can_view_sale` — trocar `['coordenador','gestor']` por `['gestor']`.
- Manter `is_lead_of` (gestor vincula corretores em `team_members`).

Promover `dacmedia16@gmail.com` a `super_admin` (você já é admin).

## 2. Regras por papel

| Papel | Cria vendas | Edita venda de outros | Aprova/devolve | Contrato | Ocorrência/comissão | Cria usuários |
|---|---|---|---|---|---|---|
| Corretor | ✅ (própria) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Gestor | ❌ | ✅ (do time) | ✅ | ❌ | ❌ | ❌ |
| Jurídico | ❌ | ✅ (após gestor aprovar) | — | ✅ | ❌ | ❌ |
| Financeiro | ❌ | ✅ | — | — | ✅ (aceita/trava) | ❌ |
| Admin | ✅ (todas) | ✅ | ✅ | ✅ | ✅ (pode reabrir) | ✅ (corretor/gestor/jurídico/financeiro) |
| Super Admin | ✅ | ✅ | ✅ | ✅ | ✅ (pode reabrir) | ✅ **inclusive Admin e Super Admin** |

## 3. Trava do financeiro

Nova função `is_sale_locked(sale_id)`:
- Retorna `true` quando `sales.status = 'ocorrencia_concluida'` **ou** `occurrences.aceita_financeiro = true` (novo campo boolean).

Efeitos:
- Policies UPDATE de `sales`, `sale_parties`, `sale_payment`, `sale_documents`, `occurrences`, `occurrence_commissions`, `occurrence_partners` ganham a cláusula:
  `AND (NOT is_sale_locked(sale_id) OR has_any_role(auth.uid(), ['financeiro','admin','super_admin']))`.
- Corretor/gestor/jurídico ficam em **modo leitura** após aceite.
- Botão **Aceitar (financeiro)** grava `aceita_financeiro = true` + status `ocorrencia_concluida`.
- Botão **Reabrir** exige justificativa e é visível para **financeiro, admin e super_admin** (já existe `reopen_reason`).

## 4. Tela de Usuários (`/admin/usuarios`)

- Rota deixa de exigir só `admin`: passa a exigir `admin OU super_admin`.
- Botão do papel **Admin** só aparece se o logado for `super_admin`.
- Botão do papel **Super Admin** só aparece para outro `super_admin` (nunca no próprio usuário — RLS `user_roles` já bloqueia auto-edição).
- Admin vê e cria: corretor, gestor, jurídico, financeiro.
- Super Admin vê e cria tudo, inclusive outros admins/super_admins.
- Remove seções/labels que citam “Coordenador” do formulário e da lista de líderes (fica só “Gestor”).

## 5. Frontend — ajustes pontuais

- `src/lib/auth.tsx` → tipo `AppRole` sem `coordenador`, com `super_admin`; `ROLE_LABEL` atualizado.
- `src/lib/status.ts` → `proximoResponsavel` e `validarProntaParaRevisao` sem menções a coordenador.
- `src/routes/_authenticated/vendas.$id.tsx`:
  - Banner “Venda travada pelo financeiro — somente leitura” quando `is_sale_locked` for verdadeiro e o usuário não puder destravar.
  - Desabilitar inputs/botões de salvar nas etapas quando travada.
  - Botão **Aceitar ocorrência** (financeiro/admin/super_admin) que dispara a trava.
- `src/routes/_authenticated/dashboard.tsx` → remover KPIs específicos de coordenador; agregar cards do super_admin junto com admin.
- `src/components/AppShell.tsx` → item “Usuários” visível para `admin` **ou** `super_admin`.

## 6. Testes manuais (adicionar a `docs/TESTE_MANUAL.md`)

- Corretor tenta editar após aceite → bloqueado com banner.
- Financeiro aceita → outros veem “somente leitura”.
- Admin tenta se auto-rebaixar → bloqueado.
- Admin tenta criar outro Admin → botão oculto.
- Super Admin cria Admin e outro Super Admin → ok.
- Usuário antigo com papel `coordenador` foi migrado para `gestor` sem perder vínculos de time.

---

## Detalhes técnicos (para referência)

- Enum change em Postgres exige recriar/renomear valores: a migração cria `app_role_new`, converte colunas, apaga o antigo e renomeia.
- Nenhum dado é apagado; `team_members` e `user_roles` são atualizados linha a linha.
- Todas as tabelas afetadas mantêm RLS e GRANTs atuais.
- Nenhum arquivo auto-gerado é editado (`types.ts`, `client.ts`, `.env`).