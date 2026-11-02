// Depoimentos do ADM MAX (t_c7cfaf00). Regras puras (sem banco), testadas em depoimentos.test.ts.
// O BANCO é quem decide de verdade (migration 20261102120000): nota 1–3 ou sem autorização viram
// feedback interno; aqui só espelhamos para a tela mostrar o caminho certo.

export const DEP_PERGUNTA_NOTA = "De 1 a 5, quanto o ADM MAX ajudou no seu dia a dia?";
export const DEP_PERGUNTA_MUDOU = "O que mudou no seu trabalho depois do ADM MAX?";
export const DEP_PERGUNTA_TAREFA = "Qual tarefa ficou mais fácil ou mais rápida?";
export const DEP_PERGUNTA_FRASE = "Se fosse indicar para um colega, o que você diria em uma frase?";
export const DEP_PERGUNTA_MELHORAR = "O que podemos melhorar?";

export const DEP_LIMITES = { mudou: 600, tarefa: 300, frase: 160, melhorar: 1000, mudouMin: 10 };

export type DepStatus = "interno" | "pendente" | "aprovado" | "recusado" | "removido";

export type DepPrevia = {
  nome_exibicao: string;
  papel: string;
  imobiliaria: string;
  cidade: string | null;
  foto_url: string | null;
};

export type DepMeu = {
  id: string;
  nota: number;
  status: DepStatus;
  consentimento: boolean;
  mudou: string | null;
  tarefa: string | null;
  frase: string | null;
  melhorar: string | null;
  criado_em: string;
  revogado_em: string | null;
};

export type DepSituacao =
  | { pode_enviar: false; convite: false; motivo: "sessao_restrita" | "plataforma" | "sem_imobiliaria" }
  | {
      pode_enviar: true;
      convite: boolean;
      motivo: "elegivel" | "recusou" | "adiado" | "ja_enviou" | "conta_nova" | "sem_uso";
      termo: { versao: string; texto: string };
      previa: DepPrevia;
      meus: DepMeu[];
    };

export type DepForm = {
  nota: number | null;
  mudou: string;
  tarefa: string;
  frase: string;
  melhorar: string;
  autorizo: boolean;
};

export const depFormVazio = (): DepForm => ({
  nota: null,
  mudou: "",
  tarefa: "",
  frase: "",
  melhorar: "",
  autorizo: false,
});

/** 4 ou 5 = convida para o depoimento; 1 a 3 = só "o que podemos melhorar" (interno). */
export function caminhoDaNota(nota: number | null): "nenhum" | "depoimento" | "melhorar" {
  if (nota == null) return "nenhum";
  return nota >= 4 ? "depoimento" : "melhorar";
}

/** Para onde o envio vai (espelho da regra do banco). */
export function destinoDoEnvio(f: DepForm): "vitrine" | "interno" {
  return caminhoDaNota(f.nota) === "depoimento" && f.autorizo ? "vitrine" : "interno";
}

/** Primeiro erro do formulário (null = pode enviar). Mesmas regras do banco. */
export function erroDoForm(f: DepForm): string | null {
  const c = caminhoDaNota(f.nota);
  if (c === "nenhum") return "Escolha uma nota de 1 a 5.";
  if (c === "melhorar") {
    const m = f.melhorar.trim();
    if (m.length < 3) return "Conte o que podemos melhorar.";
    if (m.length > DEP_LIMITES.melhorar) return "Texto muito longo.";
    return null;
  }
  const mudou = f.mudou.trim();
  if (mudou.length < DEP_LIMITES.mudouMin)
    return "Conte o que mudou no seu trabalho (pelo menos 10 letras).";
  if (mudou.length > DEP_LIMITES.mudou) return `Resposta muito longa (máx. ${DEP_LIMITES.mudou}).`;
  if (f.tarefa.trim().length > DEP_LIMITES.tarefa)
    return `Resposta muito longa (máx. ${DEP_LIMITES.tarefa}).`;
  if (f.frase.trim().length > DEP_LIMITES.frase)
    return `Frase muito longa (máx. ${DEP_LIMITES.frase}).`;
  return null;
}

/** Parâmetros da RPC depoimento_enviar. Nota baixa não leva respostas de depoimento nem autorização. */
export function paramsEnviar(f: DepForm, termoVersao: string, origem: "convite" | "link") {
  const alta = caminhoDaNota(f.nota) === "depoimento";
  const t = (s: string) => (s.trim() ? s.trim() : null);
  return {
    _nota: f.nota ?? 0,
    _mudou: alta ? t(f.mudou) : null,
    _tarefa: alta ? t(f.tarefa) : null,
    _frase: alta ? t(f.frase) : null,
    _melhorar: t(f.melhorar),
    _autorizo: alta && f.autorizo,
    _termo_versao: alta && f.autorizo ? termoVersao : null,
    _origem: origem,
  };
}

/** Mensagem amigável para o erro do banco. */
export function mensagemErroDep(e: { code?: string; message?: string } | null | undefined): string {
  const msg = e?.message ?? "";
  if (e?.code === "42501") return "Só a própria pessoa pode enviar ou retirar o depoimento.";
  if (e?.code === "23505") return "Você já tem um depoimento enviado. Retire o anterior para mandar outro.";
  if (e?.code === "22023" && msg) return traduzir(msg);
  return "Não foi possível enviar agora. Tente de novo.";
}

// O banco responde sem acento (ERRCODE 22023); a tela mostra com acento.
function traduzir(m: string): string {
  const mapa: Record<string, string> = {
    "Conte o que podemos melhorar": "Conte o que podemos melhorar.",
    "Escolha uma nota de 1 a 5": "Escolha uma nota de 1 a 5.",
    "O texto da autorizacao mudou. Recarregue a pagina.":
      "O texto da autorização mudou. Recarregue a página.",
  };
  return mapa[m] ?? m.replace("autorizacao", "autorização").replace("pagina", "página");
}

export const STATUS_DEP_LABEL: Record<DepStatus, string> = {
  interno: "Feedback interno",
  pendente: "Em análise",
  aprovado: "Publicado",
  recusado: "Não publicado",
  removido: "Retirado",
};

/** Abre o convite automático? Só quando o banco diz que sim e a pessoa não adiou neste login. */
export function abreConviteAutomatico(
  s: DepSituacao | null,
  adiadoNesteLogin: boolean,
): boolean {
  return Boolean(s && s.pode_enviar && s.convite && !adiadoNesteLogin);
}

// ---- Link /depoimento antes do login ---------------------------------------------------------
// O login passa pela Conta MAX, que só devolve para /dashboard. Quem abre o link sem sessão tem o
// pedido guardado neste navegador (vale 30 min) e o ADM retoma em /depoimento depois do login.
export const CHAVE_RETORNO_DEPOIMENTO = "max:depoimento-pos-login";
const RETORNO_VALIDADE_MS = 30 * 60 * 1000;

type Armazenamento = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function guardarRetornoDepoimento(s: Armazenamento | null, agora: number): void {
  try {
    s?.setItem(CHAVE_RETORNO_DEPOIMENTO, String(agora));
  } catch {
    /* sem armazenamento: depois do login a pessoa clica no link de novo */
  }
}

/** true = havia pedido válido (e ele é apagado). Vencido ou ilegível também é apagado. */
export function consumirRetornoDepoimento(s: Armazenamento | null, agora: number): boolean {
  try {
    const v = s?.getItem(CHAVE_RETORNO_DEPOIMENTO);
    if (v == null) return false;
    s?.removeItem(CHAVE_RETORNO_DEPOIMENTO);
    const t = Number(v);
    return Number.isFinite(t) && agora - t >= 0 && agora - t <= RETORNO_VALIDADE_MS;
  } catch {
    return false;
  }
}

/** Texto curto para o link do WhatsApp. */
export function linkDepoimento(origem: string): string {
  return `${origem.replace(/\/+$/, "")}/depoimento`;
}

// ---- Moderação --------------------------------------------------------------------------------
export type DepModeracao = {
  id: string;
  nota: number;
  status: DepStatus;
  origem: "convite" | "link";
  mudou: string | null;
  tarefa: string | null;
  frase: string | null;
  melhorar: string | null;
  mudou_corrigido: string | null;
  tarefa_corrigido: string | null;
  frase_corrigido: string | null;
  corrigido_em: string | null;
  consentimento: boolean;
  consentimento_em: string | null;
  consentimento_versao: string | null;
  nome_completo: string;
  nome_exibicao: string;
  papel: string;
  imobiliaria: string;
  cidade: string | null;
  foto_url: string | null;
  motivo_moderacao: string | null;
  moderado_em: string | null;
  aprovado_em: string | null;
  revogado_em: string | null;
  criado_em: string;
};

export type FiltroModeracao = "pendente" | "aprovado" | "recusado" | "removido" | "interno" | "todos";

export function filtrarModeracao(lista: DepModeracao[], f: FiltroModeracao): DepModeracao[] {
  return f === "todos" ? lista : lista.filter((d) => d.status === f);
}

export function contarPorStatus(lista: DepModeracao[]): Record<FiltroModeracao, number> {
  const c: Record<FiltroModeracao, number> = {
    pendente: 0,
    aprovado: 0,
    recusado: 0,
    removido: 0,
    interno: 0,
    todos: lista.length,
  };
  for (const d of lista) c[d.status] += 1;
  return c;
}

/** Ações de um clique disponíveis para cada status. Interno e retirado pelo autor não publicam. */
export function acoesModeracao(d: Pick<DepModeracao, "status" | "revogado_em">) {
  if (d.status === "interno") return [] as const;
  if (d.revogado_em) return [] as const;
  if (d.status === "pendente") return ["aprovar", "recusar"] as const;
  if (d.status === "aprovado") return ["remover"] as const;
  return ["aprovar"] as const; // recusado/removido pelo moderador: pode reconsiderar
}

/** Texto que a vitrine mostra (corrigido, se houve ajuste de digitação). */
export function textoVitrine(d: DepModeracao) {
  return {
    frase: d.frase_corrigido ?? d.frase,
    texto: d.mudou_corrigido ?? d.mudou,
    tarefa: d.tarefa_corrigido ?? d.tarefa,
  };
}
