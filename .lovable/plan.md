## Objetivo
Aplicar a identidade visual da RE/MAX (vermelho, azul e branco do balão) em todo o sistema, sem quebrar componentes shadcn nem o dark mode.

## Paleta RE/MAX oficial
- Vermelho RE/MAX: `#DC1C2E` (primário — botões, ações principais, destaques)
- Azul RE/MAX: `#003DA5` (secundário — cabeçalhos, links, badges de status)
- Branco: `#FFFFFF` (fundo claro)
- Cinza texto: `#1F2937` (foreground) e `#6B7280` (muted)
- Vermelho hover/glow: `#B8151F`
- Azul hover: `#002E7A`

## Onde aplicar (só tokens, sem tocar em lógica)
1. **`src/styles.css`** — atualizar tokens semânticos em `:root` e `.dark`:
   - `--primary` → vermelho RE/MAX + `--primary-foreground` branco
   - `--secondary` → azul RE/MAX + `--secondary-foreground` branco
   - `--accent` → azul claro para hover suave
   - `--ring` → vermelho (foco visível)
   - `--sidebar-primary` → azul RE/MAX (barra lateral com identidade)
   - `--destructive` mantém vermelho, mas afinado para não conflitar com o primário (tom mais escuro)
   - Gradiente da marca: `--gradient-remax: linear-gradient(135deg, #DC1C2E 0%, #003DA5 100%)`
   - Sombra da marca: `--shadow-remax` com tint vermelho
2. **`AppShell` / cabeçalho** — usar `bg-secondary` (azul) no topo com texto branco, faixa vermelha fina abaixo (opcional, 3px) para reforçar a marca.
3. **Badges de status** (`src/lib/status.ts`) — revisar tons para casarem com a paleta (aprovado = azul, ação urgente = vermelho, concluído = verde neutro).
4. **Botões primários** já herdarão o vermelho automaticamente via `--primary`.
5. **Dashboard KPIs** — ícones em azul, valores destacados em vermelho quando pendentes.

## O que NÃO muda
- Nenhum componente, rota, fluxo, RLS ou lógica de negócio.
- Nenhuma classe hardcoded (`bg-red-500` etc.) — tudo via tokens.
- Estrutura de dark mode preservada (versão escura com vermelho um pouco mais claro para contraste).

## Entregáveis
- `src/styles.css` atualizado com paleta RE/MAX.
- Pequeno ajuste no `AppShell` para faixa/cabeçalho da marca.
- Ajuste fino nos tons de badge em `src/lib/status.ts` se necessário.

Quer que eu inclua também o **logo/balão RE/MAX** no cabeçalho, ou mantenho só as cores por enquanto?