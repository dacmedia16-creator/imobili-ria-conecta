// t_45d0f5aa (Denis, 20/11/2026, tópico 6238): MODO EQUIPE da Nicole, por imobiliária (lead_config.ia_modo_equipe,
// nasce DESLIGADO). Feito para o Piloto C2S, em que a passagem vai para o MAX Principal (sino) e NÃO para um corretor:
//   - a Nicole não promete corretor, visita marcada nem prazo; diz que vai passar o pedido para a equipe;
//   - "marquei visita e ninguém apareceu": reconhece a reclamação, sem assumir compromisso, e anota para a equipe.
// Roda DEPOIS do roteiro e do modelo, ANTES de gravar (texto determinístico; não chama o modelo).
// Desligado (ou coluna ausente) = comportamento de antes, sem nenhuma mudança.
import { norm, semConviteVisita, type RespostaIa } from "./leads-ia";

export const EQUIPE_PASSAR = "Vou passar seu pedido para a equipe.";
export const EQUIPE_VISITA =
  "Vou passar seu pedido de visita para a equipe. Se quiser, me diz o dia e o período que preferir, que eu anoto junto.";
export const EQUIPE_VISITA_ANOTADA = "Vou passar seu pedido de visita para a equipe.";
export const EQUIPE_DUVIDA = "Anotei essa dúvida para a equipe.";
export const EQUIPE_RECLAMACAO =
  "Sinto muito pelo transtorno! Vou passar seu pedido para a equipe. Enquanto isso, quer que eu te mostre outras opções?";

/** "marquei visita e ninguém apareceu", "agendei a visita e não vieram", "ninguém me ligou para a visita". */
export function reclamouVisita(texto: string): boolean {
  const n = norm(texto);
  if (!/\bvisit/.test(n)) return false;
  return (
    /\b(ninguem|nenhum corretor|ningue)\b/.test(n) ||
    /\bnao (apareceu|apareceram|veio|vieram|compareceu|ligou|ligaram|retornou|retornaram|confirmou|confirmaram|marcou|marcaram|chamou|chamaram)\b/.test(n) ||
    /\b(me deixaram|me deu|deram) (o )?(bolo|cano)\b/.test(n)
  );
}

/** Frase que promete corretor, horário ou contato de alguém (inclui o {corretor} que o banco trocaria). */
const PROMESSA = /\{corretor\}|\bcorretor(a|es|as)?\b|\bconfirma(r|mos)? o horario\b|\b(visita (?:esta |ja )?(?:confirmad[ao]|agendad[ao]|marcad[ao])|(?:confirmamos|garantimos) a visita)\b|\b(?:te |lhe )?(?:ligo|ligamos|chamo|chamamos|retorno|retornamos|respondo|respondemos)\b|\b(?:ate amanha|ainda hoje|em ate \d+ (?:horas?|dias?))\b/;

/** Troca as frases de corretor/horário pelas da equipe (sem duplicar) e tira convite de visita. */
export function textoModoEquipe(msg: string): string {
  if (!msg.trim()) return msg;
  const partes = msg.trim().split(/(?<=[.!?])\s+/);
  // Dia/período já anotado ("Sábado de manhã anotado!"): não pergunta de novo.
  const anotado = /\banotad[oa]\b/.test(norm(msg));
  const out: string[] = [];
  const add = (f: string) => {
    if (!out.includes(f)) out.push(f);
  };
  for (const p of partes) {
    const np = norm(p);
    if (!PROMESSA.test(np)) {
      out.push(p);
      continue;
    }
    // "Qual dia e período ficam melhores? O corretor confirma o horário" -> pedido de visita para a equipe.
    // "o corretor confirma a disponibilidade com você na visita ou no contato" é dúvida, não visita.
    if (/\b(horario|dia|periodo|agendar|agendamento)\b/.test(np)) add(anotado ? EQUIPE_VISITA_ANOTADA : EQUIPE_VISITA);
    else if (/\bconfirma\b/.test(np)) add(EQUIPE_DUVIDA);
    else add(EQUIPE_PASSAR);
  }
  // A pergunta "qual dia e período?" já está dentro de EQUIPE_VISITA.
  const semDia = out.includes(EQUIPE_VISITA)
    ? out.filter((p) => p === EQUIPE_VISITA || !/\b(qual|que) dia\b|\bperiodo\b|manha ou (a )?tarde/.test(norm(p)))
    : out;
  // A equipe não tem agenda garantida: sem convite para "agendar/marcar visita".
  const txt = semConviteVisita(semDia.join(" "));
  return txt.replace(/\s+/g, " ").trim() || EQUIPE_PASSAR;
}

/** Aplica o modo equipe na resposta já decidida (roteiro ou modelo). */
export function aplicarModoEquipe(r: RespostaIa, texto: string): RespostaIa {
  if (reclamouVisita(texto)) {
    const pend = "reclamou: visita marcada antes não aconteceu";
    const dados = {
      ...r.dados,
      pendentes: [...new Set([...(r.dados.pendentes ?? []), pend])].slice(0, 12),
      convite_aberto: "opcoes" as const,
    };
    return { ...r, passo: "fim", dados, resposta: EQUIPE_RECLAMACAO,
      resposta_falha: "Sinto muito pelo transtorno! Anotei sua reclamação aqui.",
      fim: "sensivel", resumo: "Cliente relatou que uma visita marcada antes não aconteceu; equipe deve conferir, sem compromisso de prazo." };
  }
  if (r.fim === "visita") {
    const abertura = r.dados.visita ? `Anotei sua preferência: ${r.dados.visita}. ` : "";
    return { ...r, resposta: `${abertura}${EQUIPE_VISITA_ANOTADA}`,
      resposta_falha: `${abertura}Anotei sua preferência de visita aqui.` };
  }
  return {
    ...r,
    resposta: textoModoEquipe(r.resposta),
    resposta_falha: r.resposta_falha ? textoModoEquipe(r.resposta_falha) : r.resposta_falha,
  };
}
