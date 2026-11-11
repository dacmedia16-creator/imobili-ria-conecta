// Ajuda MAX na Locação — fatia 1/2 (t_b037935e). Ordem de uma pergunta, sem rede própria: quem chama injeta o
// banco e a IA. Assim o caminho completo (respondida, fora do manual, limite, IA indisponível) é testado com
// respostas simuladas, e a função de servidor só liga as peças reais.
import {
  LIMITE_DIA,
  TEXTO_DESLIGADO,
  TEXTO_INDISPONIVEL,
  TEXTO_LIMITE,
  lerResposta,
  prepararEntrada,
  promptSistema,
  type Mensagem,
  type RespostaAjuda,
  type Tela,
} from "@/lib/ajuda-max-locacao";

export type Reserva =
  | { ok: true; usadas: number; limite: number; org: string; dia: string }
  | { ok: false; usadas: number; limite: number };

export type ChamadaIA = {
  sistema: string;
  conteudos: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
};

export type RetornoIA =
  | { ok: true; texto: string; entrada: number; saida: number }
  | { ok: false; erro: "tempo" | "rede" | "status" };

export type DepsFluxo = {
  /** RPC ajuda_max_locacao_reservar com o login de quem pergunta. Lança se desligado. */
  reservar: () => Promise<unknown>;
  /** RPC ajuda_max_locacao_fechar com service_role. */
  fechar: (
    org: string,
    dia: string,
    resultado: "sabe" | "nao_sabe" | "falha",
    entrada: number,
    saida: number,
  ) => Promise<void>;
  /** Chamada ao modelo. Ausente = chave da IA não configurada neste ambiente. */
  chamarIA: ((c: ChamadaIA) => Promise<RetornoIA>) | null;
  /** Só números (nunca texto da pergunta/resposta). */
  log?: (msg: string) => void;
  /**
   * Fatia 2/2 (t_365484dc): registra a pergunta que a IA não soube responder como "dúvida sem resposta" (chamado
   * origem 'locacao', com o login de quem perguntou). Ausente = não registra. Falha não derruba a resposta.
   */
  registrarDuvida?: (pergunta: string) => Promise<number | null>;
};

/** Leitura fechada do retorno da RPC de reserva. */
export function lerReserva(raw: unknown): Reserva | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  const usadas = typeof x.usadas === "number" ? x.usadas : 0;
  const limite = typeof x.limite === "number" ? x.limite : LIMITE_DIA;
  if (x.ok === true && typeof x.org === "string" && typeof x.dia === "string")
    return { ok: true, usadas, limite, org: x.org, dia: x.dia };
  if (x.ok === false) return { ok: false, usadas, limite };
  return null;
}

/** Monta o pedido à IA: manual no system, histórico curto e pergunta já mascarados. Nada da locação vai junto. */
export function montarChamada(tela: Tela, pergunta: string, historico: Mensagem[]): ChamadaIA {
  const e = prepararEntrada(pergunta, historico);
  const conteudos: ChamadaIA["conteudos"] = e.historico.map((m) => ({
    role: m.papel === "usuario" ? "user" : "model",
    parts: [{ text: m.texto }],
  }));
  // A API pede que a conversa comece pelo usuário.
  while (conteudos.length && conteudos[0].role !== "user") conteudos.shift();
  conteudos.push({ role: "user", parts: [{ text: e.pergunta }] });
  return { sistema: promptSistema(tela), conteudos };
}

export async function responderPergunta(
  entrada: { pergunta: string; tela: Tela; historico: Mensagem[] },
  deps: DepsFluxo,
): Promise<RespostaAjuda> {
  const log = deps.log ?? (() => {});
  let reserva: Reserva | null;
  try {
    reserva = lerReserva(await deps.reservar());
  } catch {
    return {
      ok: false,
      motivo: "desligado",
      mensagem: TEXTO_DESLIGADO,
      usadas: 0,
      limite: LIMITE_DIA,
    };
  }
  if (!reserva) {
    return {
      ok: false,
      motivo: "falha",
      mensagem: TEXTO_INDISPONIVEL,
      usadas: 0,
      limite: LIMITE_DIA,
    };
  }
  if (!reserva.ok) {
    return {
      ok: false,
      motivo: "limite",
      mensagem: TEXTO_LIMITE(reserva.limite),
      usadas: reserva.usadas,
      limite: reserva.limite,
    };
  }
  const { org, dia, limite } = reserva;
  // Devolve a pergunta reservada: a IA não respondeu, então não conta no limite.
  const devolver = async (motivo: "indisponivel" | "falha"): Promise<RespostaAjuda> => {
    let usadas = Math.max(reserva.usadas - 1, 0);
    try {
      await deps.fechar(org, dia, "falha", 0, 0);
    } catch {
      usadas = reserva.usadas;
      log("[ajuda-max] fechar falhou");
    }
    return { ok: false, motivo, mensagem: TEXTO_INDISPONIVEL, usadas, limite };
  };

  if (!deps.chamarIA) {
    log("[ajuda-max] IA sem chave neste ambiente");
    return devolver("indisponivel");
  }
  const r = await deps.chamarIA(montarChamada(entrada.tela, entrada.pergunta, entrada.historico));
  if (!r.ok) {
    log(`[ajuda-max] IA ${r.erro}`);
    return devolver("falha");
  }
  const lida = lerResposta(r.texto);
  if (!lida) {
    log("[ajuda-max] resposta fora do formato");
    return devolver("falha");
  }
  try {
    await deps.fechar(org, dia, lida.sabe ? "sabe" : "nao_sabe", r.entrada, r.saida);
  } catch {
    log("[ajuda-max] fechar falhou");
  }
  log(`[ajuda-max] ok sabe=${lida.sabe ? 1 : 0} tokens=${r.entrada}/${r.saida}`);
  if (!lida.sabe && deps.registrarDuvida) {
    let registro: { numero: number | null } | null = null;
    try {
      registro = { numero: await deps.registrarDuvida(entrada.pergunta) };
    } catch {
      log("[ajuda-max] duvida nao registrada");
    }
    return {
      ok: true,
      sabe: false,
      resposta: lida.resposta,
      usadas: reserva.usadas,
      limite,
      duvida: registro ? { registrada: true, numero: registro.numero } : { registrada: false },
    };
  }
  return { ok: true, sabe: lida.sabe, resposta: lida.resposta, usadas: reserva.usadas, limite };
}

/** Texto da resposta do Gemini (ignora partes de raciocínio) e contagem de tokens. */
export function lerRetornoGemini(json: unknown): { texto: string; entrada: number; saida: number } {
  const j = (json ?? {}) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }>;
    usageMetadata?: {
      promptTokenCount?: unknown;
      candidatesTokenCount?: unknown;
      thoughtsTokenCount?: unknown;
    };
  };
  const partes = j.candidates?.[0]?.content?.parts ?? [];
  const texto = partes
    .filter((p) => p.thought !== true && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const u = j.usageMetadata ?? {};
  return {
    texto,
    entrada: n(u.promptTokenCount),
    saida: n(u.candidatesTokenCount) + n(u.thoughtsTokenCount),
  };
}
