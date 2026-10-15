# Mural de Conquistas — base de dados (backend)

Módulo aprovado por Denis em 15/10/2026 (maquete t_3982960f). Este documento cobre só a base:
banco, segurança, flag do módulo e tempo real. Tela do mural e confete ficam nas tarefas seguintes.

- Branch: `feat/mural-conquistas-t_aab528e5` (sem merge, sem `deploy:safe`, sem migration em produção).
- Módulo: `mural_conquistas` — nasce DESLIGADO em todas as imobiliárias. Só o super-admin liga,
  em Plataforma → Imobiliárias → Módulos (`ORGANIZATION_MODULES` em `src/lib/platform-organizations.ts`).
- Nunca guarda valor, comissão nem nome do cliente. Não altera nem faz backfill de vendas.

## Migrations

| Arquivo | O que faz |
| --- | --- |
| `supabase/migrations/20261015120000_mural_conquistas.sql` | módulo, tabelas, RLS, gatilhos, RPCs e Realtime |
| `supabase/rollback/20261015120000_mural_conquistas.sql` | reversão completa (mantém `profile_birthdates`; ver linha comentada no fim) |
| `supabase/tests/mural_conquistas_isolamento.sql` | suíte SQL (34 verificações), tudo em transação com `ROLLBACK` |

Rodar no banco LOCAL (nunca remoto):

```
psql ... -v ON_ERROR_STOP=1 < supabase/tests/mural_conquistas_isolamento.sql
# termina com: MURAL DE CONQUISTAS: TODOS OS TESTES PASSARAM
```

## Regra da venda (fonte única)

A conquista existe enquanto a venda estiver em `public.vendas_comerciais_validas()` — a mesma RPC dos
relatórios. Ou seja: contrato assinado e etapas seguintes; lançamento só entra quando vai ao Financeiro.
`venda_em` vem da própria RPC (data de assinatura ou ida ao Financeiro).

## Tabelas

### `achievement_posts` (uma conquista por venda)

| Campo | Tipo | Observação |
| --- | --- | --- |
| id | uuid PK | |
| organization_id | uuid | imobiliária |
| sale_id | uuid UNIQUE | idempotência: nunca há dois posts da mesma venda |
| venda_em | timestamptz | assinatura / ida ao Financeiro (da RPC de vendas válidas) |
| captador_id, captador_nome | uuid, text | papel: captador |
| vendedor_id, vendedor_nome | uuid, text | papel: vendedor |
| coordenador_id, coordenador_nome | uuid, text | papel: coordenador/broker, se houver |
| tipo_imovel, bairro, cidade | text | só descrição do imóvel |
| ativo | boolean | `false` = revogada (cancelada ou voltou de status) |
| created_at, updated_at | timestamptz | |

O tipo venda/lançamento está em `sales.modalidade`; não é copiado para o post.

### `achievement_cheers` (parabéns)

PK `(post_id, user_id)` = uma vez por pessoa. Campos: post_id, user_id, organization_id, created_at.

### `achievement_mutes` (silenciar comemorações)

PK `user_id`. Preferência do próprio usuário.

### `profile_birthdates` (aniversariantes)

Não existia data de nascimento no sistema. Tabela nova, 1:1 com `profiles`: `user_id`, `data_nascimento`,
`updated_at`. Só o próprio usuário lê a data completa (decisão aprovada); o mural recebe apenas dia/mês.
Gravação só pela RPC `profile_set_birthdate`. Nenhum dado é inventado: fica vazio até o usuário preencher.

## Gatilhos (idempotentes)

- `AFTER INSERT ON sale_status_history` → `achievement_sync_sale(sale_id)` (gancho de `change_sale_status`).
- `AFTER UPDATE ON sales` quando muda status, modalidade, data de assinatura, equipe ou imóvel.
- `achievement_sync_sale`:
  - venda fora de `vendas_comerciais_validas()` → `ativo = false` (revoga; não apaga);
  - módulo desligado → não grava nada, nenhum evento;
  - senão `INSERT ... ON CONFLICT (sale_id) DO UPDATE` só se algo mudou. Reassinar reativa o MESMO post
    por UPDATE, então o confete (que escuta só INSERT) não dispara de novo.
- Erro no mural vira `WARNING`: nunca trava a mudança de status da venda.

## Segurança (RLS)

- Escrita direta bloqueada para `anon`/`authenticated`; só as funções `SECURITY DEFINER` gravam.
- `achievement_posts` e `achievement_cheers`: políticas RESTRICTIVE de mesma imobiliária
  (`current_org_id()`) e de módulo ligado (`achievements_enabled()`). Módulo desligado → leitura vazia.
- Posts revogados (`ativo = false`) não aparecem na leitura.
- `achievement_sync_sale` não é executável por `authenticated`.

## RPCs (todas exigem login; respeitam imobiliária atual e módulo ligado)

```
achievement_feed(_limit integer DEFAULT 30)
  -> TABLE(id uuid, venda_em timestamptz, captador_nome text, vendedor_nome text, coordenador_nome text,
           tipo_imovel text, bairro text, cidade text, cheers bigint, cheered_by_me boolean)
achievement_cheer(_post_id uuid) -> bigint            -- total de parabéns do post
achievement_ranking(_ano integer, _mes integer)
  -> TABLE(user_id uuid, nome text, avatar_url text, pontos bigint)
     -- quantidade, sem valores; captador +1 e vendedor +1; mês em America/Sao_Paulo; top 20
achievement_birthdays(_mes integer)
  -> TABLE(user_id uuid, nome text, avatar_url text, dia integer, mes integer)   -- nunca ano/idade
achievement_set_muted(_muted boolean) -> boolean
profile_set_birthdate(_data date) -> date             -- NULL apaga
achievements_enabled() -> boolean                    -- módulo ligado na imobiliária atual
```

Exemplo de fuso coberto em teste: venda assinada 31/01 às 23h30 em SP (01/02 02h30 UTC) conta em janeiro.

## Tempo real (para a tarefa do confete)

`achievement_posts` está na publicação `supabase_realtime`. Usa `postgres_changes`, que entrega INSERT/UPDATE
somente para quem passa na RLS de SELECT — portanto só a mesma imobiliária e só com o módulo ligado
(conferido na doc do Supabase via Context7). Não usamos DELETE (o mural nunca apaga linha).

```ts
supabase
  .channel(`mural-conquistas:${organizationId}`) // nome livre; o isolamento vem da RLS
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "achievement_posts",
      filter: `organization_id=eq.${organizationId}`,
    },
    (payload) => {
      /* payload.new: linha de achievement_posts */
    },
  )
  .subscribe();
```

Formato de `payload.new` (é a linha da tabela, sem valores financeiros):

```json
{
  "id": "uuid", "organization_id": "uuid", "sale_id": "uuid",
  "venda_em": "2026-10-15T14:00:00+00:00",
  "captador_id": "uuid", "captador_nome": "Ana",
  "vendedor_id": "uuid", "vendedor_nome": "Caio",
  "coordenador_id": null, "coordenador_nome": null,
  "tipo_imovel": "Casa", "bairro": "Campolim", "cidade": "Sorocaba",
  "ativo": true, "created_at": "...", "updated_at": "..."
}
```

Regras para o confete: disparar só em INSERT; respeitar `achievement_mutes` do usuário e
`prefers-reduced-motion`.

## Validação local (15/10/2026, container descartável `adm-mural`)

- Migration aplicada → rollback → reaplicada sem erro; após reaplicar, 0 imobiliárias com o módulo ligado.
- Suíte: 34/34 (isolamento entre 2 imobiliárias, módulo desligado, idempotência, revogação por
  cancelamento e por volta de status, lançamento, fuso de SP, aniversário sem ano, anon e RPC interna bloqueados).
