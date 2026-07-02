# Acesso por perfil — confirmação e pequenos ajustes

Mantemos o isolamento atual (que já é o que você quer). Este plano só adiciona **visibilidade e auditoria** para você conseguir verificar que ninguém vê o que não deve.

## Como fica cada papel

| Papel | Vê | Edita |
|---|---|---|
| Corretor | Só as vendas onde é o `corretor_id` | Só rascunho/devolvida das próprias |
| Gestor | Só vendas de corretores vinculados em `team_members` | Idem, respeitando trava do financeiro |
| Jurídico | Todas as vendas a partir de "aprovada pelo gestor" | Campos jurídicos, respeitando trava |
| Financeiro | Todas as vendas, qualquer status | Tudo; é quem trava/libera |
| Admin | Tudo | Tudo, exceto conceder papel Admin/Super Admin |
| Super Admin | Tudo | Tudo, inclusive papéis Admin/Super Admin |

Regra transversal: **quando o financeiro clica "Aceitar e travar", corretor/gestor/jurídico ficam em modo leitura** até o financeiro (ou admin/super admin) liberar.

## O que este plano faz

1. **Tela "Meu acesso"** (em `/perfil` ou aba no dashboard): mostra ao usuário logado seus papéis, sua equipe (líderes/liderados) e uma frase clara do tipo *"Você vê apenas as vendas onde é o corretor responsável"*. Serve de auto-checagem.

2. **Aviso no topo da lista de vendas** quando o filtro aplicado pelo RLS reduz o resultado (ex.: gestor sem membros vinculados vê "Nenhum corretor vinculado a você — peça ao admin para associar sua equipe").

3. **Log de acesso a vendas sensíveis**: registrar em `activity_logs` toda vez que um usuário **abre** uma venda que não é dele (útil para auditoria futura). Ação `sale_viewed` com `sale_id` + `autor_id`.

4. **Checklist de teste de isolamento** em `docs/TESTE_ACESSO.md`: 8 cenários prontos (corretor A não vê venda do corretor B; gestor sem vínculo não vê nada; jurídico não vê rascunho; financeiro trava e corretor perde edição; admin não consegue se auto-promover; etc.) para você rodar antes de liberar para a equipe.

5. **Não muda nenhuma policy** — o isolamento já está correto conforme suas respostas.

## Fora do escopo

- Não vamos afrouxar visibilidade de corretor/gestor.
- Não vamos criar "modo espectador" entre corretores.
- Não mexemos em papéis nem em trava do financeiro (já feito na rodada anterior).

## Detalhes técnicos

- Frontend: nova rota `/perfil` (ou seção no dashboard) lendo `user_roles` + `team_members` do próprio usuário.
- Frontend: em `/vendas` (lista), quando `sales.length === 0`, mostrar mensagem contextual conforme o papel.
- Frontend: em `/vendas/:id`, no `load()`, disparar `insert` em `activity_logs` com `acao='sale_viewed'` apenas quando `sale.corretor_id !== user.id` (evita ruído).
- Doc: `docs/TESTE_ACESSO.md` com passos manuais numerados.
