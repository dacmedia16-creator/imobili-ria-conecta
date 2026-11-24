/**
 * Melhorias de tela, lote 2 (t_29b7cd5e, itens 4-6 do t_d62be550). Só apresentação:
 * filtrar o quadro do CRM, numerar etapas, escolher atalhos da barra inferior e montar a busca
 * rápida. Nenhuma regra de quem vê ou de quem pode agir mora aqui: a barra e a busca usam só os
 * itens que o menu lateral já liberou (montarMenuLateral, `show`), e a RLS e as RPCs continuam
 * sendo a proteção real (PRs #412, #413 e #414).
 */
import { ORIGEM_LABEL, type Lead, type Origem } from "@/lib/leads";
import { estadoProximo, FUNIL, nomeEtapa, type Etapa, type Funil } from "@/lib/crm";
import type { NavGroup, NavItem } from "@/lib/menu-lateral";

// ---------------------------------------------------------------- CRM: filtros rápidos

export type Situacao = "todos" | "atrasados" | "sem";
export type FiltroQuadro = { situacao: Situacao; origem: Origem | "" };
export const FILTRO_VAZIO: FiltroQuadro = { situacao: "todos", origem: "" };

export const filtroAtivo = (f: FiltroQuadro) => f.situacao !== "todos" || f.origem !== "";

/** Aplica os filtros rápidos (Atrasados, Sem próximo passo, Origem). Encerrados nunca são "atrasados". */
export function filtrarQuadro(leads: readonly Lead[], f: FiltroQuadro, hoje: string): Lead[] {
  return leads.filter((l) => {
    if (f.origem && l.origem !== f.origem) return false;
    if (f.situacao === "todos") return true;
    const est = estadoProximo(l, hoje);
    return f.situacao === "atrasados" ? est === "atrasado" : est === "sem";
  });
}

/** Contadores dos chips, sempre sobre a lista do funil (com a origem escolhida, sem a situação). */
export function contarSituacoes(leads: readonly Lead[], origem: Origem | "", hoje: string) {
  const base = origem ? leads.filter((l) => l.origem === origem) : leads;
  let atrasados = 0;
  let sem = 0;
  for (const l of base) {
    const est = estadoProximo(l, hoje);
    if (est === "atrasado") atrasados++;
    else if (est === "sem") sem++;
  }
  return { todos: base.length, atrasados, sem };
}

/** Origens que existem nos leads do funil, com rótulo, em ordem alfabética (o seletor não mostra opção vazia). */
export function origensPresentes(leads: readonly Lead[]): { valor: Origem; rotulo: string }[] {
  const set = new Set(leads.map((l) => l.origem));
  return [...set]
    .map((o) => ({ valor: o, rotulo: ORIGEM_LABEL[o] ?? o }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

// ---------------------------------------------------------------- CRM: etapas visíveis

/** "Etapa 2 de 6" (1-based). Etapa fora do funil devolve 0. */
export function posicaoEtapa(funil: Funil, etapa: Etapa) {
  const etapas = FUNIL[funil].etapas;
  return { n: etapas.indexOf(etapa) + 1, total: etapas.length, nome: nomeEtapa(funil, etapa) };
}

/** Etapa vizinha (anterior/seguinte) para os botões do celular; null nas pontas. */
export function etapaVizinha(funil: Funil, etapa: Etapa, sentido: -1 | 1): Etapa | null {
  const etapas = FUNIL[funil].etapas;
  const i = etapas.indexOf(etapa);
  const j = i + sentido;
  return i < 0 || j < 0 || j >= etapas.length ? null : etapas[j];
}

/** Texto do indicador do computador: "Etapas 1–4 de 6" ou "Todas as 6 etapas". */
export function textoEtapasVisiveis(primeira: number, ultima: number, total: number) {
  if (primeira <= 1 && ultima >= total) return `Todas as ${total} etapas`;
  return `Etapas ${primeira}–${ultima} de ${total}`;
}

// ---------------------------------------------------------------- Celular: barra inferior

/** Atalhos possíveis, em ordem de prioridade. Cada linha é um "lugar"; vale o primeiro item visível dela. */
const PRIORIDADE_BARRA: { rotas: string[]; curto: string }[] = [
  { rotas: ["/dashboard"], curto: "Início" },
  { rotas: ["/crm"], curto: "CRM" },
  { rotas: ["/painel-leads", "/meus-leads"], curto: "Leads" },
  { rotas: ["/vendas"], curto: "Vendas" },
  { rotas: ["/locacoes"], curto: "Locação" },
  { rotas: ["/exclusividades"], curto: "Captação" },
  { rotas: ["/fotografo"], curto: "Fotos" },
  { rotas: ["/reservas-salas"], curto: "Salas" },
  { rotas: ["/notificacoes"], curto: "Avisos" },
];

export type AtalhoBarra = NavItem & { curto: string };

/**
 * Até `max` atalhos para a barra inferior do celular (o 5º botão é sempre "Mais", que abre o menu).
 * Só entra item que o menu lateral já mostra para o papel (show = true): a barra nunca libera nada novo.
 */
export function atalhosBarraInferior(groups: readonly NavGroup[], max = 4): AtalhoBarra[] {
  const visiveis = groups.flatMap((g) => g.items.filter((i) => i.show));
  const out: AtalhoBarra[] = [];
  for (const p of PRIORIDADE_BARRA) {
    if (out.length >= max) break;
    const item = p.rotas.map((r) => visiveis.find((i) => i.to === r && !i.search)).find(Boolean);
    if (item) out.push({ ...item, curto: p.curto });
  }
  return out;
}

/** Rotas em que a própria tela já tem uma barra fixa embaixo: a barra global some para não cobrir. */
const ROTAS_COM_BARRA_PROPRIA = ["/minha-carreira/plano"];
export const mostraBarraInferior = (pathname: string) =>
  !ROTAS_COM_BARRA_PROPRIA.some((r) => pathname === r || pathname.startsWith(`${r}/`));

/** O atalho está ativo na rota atual? Início só na rota exata; os outros também nas subpáginas. */
export function atalhoAtivo(to: string, pathname: string) {
  if (to === "/dashboard" || to === "/") return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

// ---------------------------------------------------------------- Menu: grupos recolhíveis

export const GRUPOS_FECHADOS_KEY = "adm-max:menu-grupos-fechados";

/** Lê a lista de grupos fechados guardada no navegador. Valor estragado = tudo aberto. */
export function lerGruposFechados(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function alternarGrupo(fechados: readonly string[], label: string): string[] {
  return fechados.includes(label) ? fechados.filter((g) => g !== label) : [...fechados, label];
}

/** Rota atual pertence a este grupo? (o grupo da página aberta nunca fica escondido) */
export function grupoTemRota(group: NavGroup, pathname: string) {
  return group.items.some(
    (i) => i.show && (i.to === "/dashboard" ? pathname === i.to : atalhoAtivo(i.to, pathname)),
  );
}

// ---------------------------------------------------------------- Busca rápida (Ctrl+K)

export type ItemBusca = NavItem & { grupo: string; chave: string };

/** Itens visíveis do menu para a busca rápida, com o nome do grupo (sem duplicar a mesma rota+aba). */
export function itensDaBusca(groups: readonly NavGroup[]): ItemBusca[] {
  const vistos = new Set<string>();
  const out: ItemBusca[] = [];
  for (const g of groups) {
    for (const i of g.items) {
      if (!i.show) continue;
      const chave = `${i.to}?${i.search?.aba ?? ""}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      out.push({ ...i, grupo: g.label ?? "Principal", chave });
    }
  }
  return out;
}

const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Filtra a busca rápida por TRECHO do nome (sem acento, sem maiúscula), não por letras soltas:
 * "crm" acha só "CRM". Ordem: nome que começa com o texto → palavra que começa → trecho no nome →
 * trecho no grupo. Texto vazio devolve tudo na ordem do menu.
 */
export function buscarItens(itens: readonly ItemBusca[], consulta: string): ItemBusca[] {
  const q = normalizar(consulta);
  if (!q) return [...itens];
  const termos = q.split(/\s+/).filter(Boolean);
  const nota = (i: ItemBusca) => {
    const nome = normalizar(i.label);
    const grupo = normalizar(i.grupo);
    const tudo = `${nome} ${grupo}`;
    if (!termos.every((t) => tudo.includes(t))) return -1;
    if (nome.startsWith(q)) return 0;
    if (nome.split(/[\s·/-]+/).some((p) => p.startsWith(termos[0]))) return 1;
    if (nome.includes(q)) return 2;
    return 3;
  };
  return itens
    .map((i, ordem) => ({ i, n: nota(i), ordem }))
    .filter((x) => x.n >= 0)
    .sort((a, b) => a.n - b.n || a.ordem - b.ordem)
    .map((x) => x.i);
}

/** Ctrl+K (Windows/Linux) ou ⌘K (Mac) abre a busca. */
export const ehAtalhoBusca = (e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">) =>
  (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k";
