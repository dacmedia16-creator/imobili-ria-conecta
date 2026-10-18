// Gestão de um envelope JÁ em assinatura (status running) na Clicksign, sem Deno (testável com mock).
// Ações: "status" (quem já assinou), "notify" (reenviar aviso a quem falta) e "edit_signer" (trocar
// nome/e-mail de quem ainda não assinou). A regra de quem pode e de qual envelope fica no banco
// (clicksign_manage_authorize, chamada com o JWT do usuário). Nunca devolve nem registra e-mail em
// claro: só mascarado na tela e sha256 no banco.
import {
  ClicksignClient,
  ClicksignError,
  maskEmail,
  normEmail,
  normName,
  notifySigners,
  requirementIdsFor,
  ROLE_BY_PAPEL,
  sha256Hex,
  signerStates,
  validEmail,
  validSignerName,
  type FetchLike,
  type Papel,
  type StoredSigner,
} from "../_shared/clicksign.ts";

/** Espera mínima entre dois "Reenviar aviso" do mesmo envelope (o banco aplica; aqui é o texto). */
export const NOTIFY_COOLDOWN_MIN = 10;
/**
 * Só estes papéis são editáveis aqui. Corretor vem do cadastro do captador e a Imobiliária da lista
 * autorizada da org: trocar o e-mail deles por aqui furaria essas regras (corrige-se no cadastro).
 */
export const EDITABLE_PAPEIS: ReadonlySet<Papel> = new Set([
  "proprietario_1",
  "proprietario_2",
  "testemunha",
]);

const LABEL: Record<Papel, string> = {
  proprietario_1: "Proprietário 1",
  proprietario_2: "Proprietário 2",
  corretor: "Corretor",
  imobiliaria: "Imobiliária",
  testemunha: "Testemunha",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ManageContext = {
  envelopeRow: string;
  envelopeKey: string;
  documentKey: string;
  isTest: boolean;
  signers: StoredSigner[];
  testMode: boolean;
  allowlistSha256: string[];
  token: string | null;
};

export type ManageDeps = {
  /** RPC clicksign_manage_authorize com o JWT do usuário; lança Error com mensagem clara. */
  authorize(captureId: string): Promise<{ org: string; envelope: string }>;
  loadContext(org: string, envelopeRow: string): Promise<ManageContext>;
  /** Trava curta contra duplo clique/duas abas; "cooldown" = aviso reenviado há menos de 10 min. */
  lock(envelopeRow: string, kind: "notify" | "edit"): Promise<"ok" | "busy" | "cooldown">;
  /** Solta a trava, grava signatários/aviso e registra no histórico (action null = só solta). */
  done(
    envelopeRow: string,
    p: {
      action: "clicksign_aviso" | "clicksign_signatario" | null;
      detail?: string;
      signers?: StoredSigner[];
      notified?: boolean;
    },
  ): Promise<void>;
  actorId: string;
  fetch: FetchLike;
  clicksignBase?: string;
};

export type CoreResult = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): CoreResult => ({
  status,
  body: { error, ...extra },
});

function labelOf(list: StoredSigner[], idx: number): string {
  const s = list[idx];
  if (s.papel === "testemunha" || s.papel === "imobiliaria") {
    const n = list.slice(0, idx + 1).filter((x) => x.papel === s.papel).length;
    return `${LABEL[s.papel]} ${n}`;
  }
  return LABEL[s.papel];
}

async function readStates(client: ClicksignClient, ctx: ManageContext) {
  const [signers, events] = await Promise.all([
    client.listSigners(ctx.envelopeKey),
    client.listDocumentEvents(ctx.envelopeKey, ctx.documentKey),
  ]);
  return signerStates(ctx.signers, signers, events);
}

export async function handleManage(deps: ManageDeps, body: unknown): Promise<CoreResult> {
  const b = (body ?? {}) as Record<string, unknown>;
  const captureId = typeof b.capture_id === "string" ? b.capture_id : "";
  const action = b.action;
  if (!UUID_RE.test(captureId)) return fail(400, "Captação inválida");
  if (action !== "status" && action !== "notify" && action !== "edit_signer") {
    return fail(400, "Ação inválida");
  }

  let auth: { org: string; envelope: string };
  try {
    auth = await deps.authorize(captureId);
  } catch (e) {
    return fail(403, e instanceof Error ? e.message : "Ação não autorizada");
  }
  const ctx = await deps.loadContext(auth.org, auth.envelope);
  if (!ctx.token) return fail(503, "Chave da Clicksign não configurada para esta imobiliária");
  const client = new ClicksignClient(ctx.token, deps.fetch, deps.clicksignBase);

  if (action === "status") {
    try {
      const states = await readStates(client, ctx);
      return {
        status: 200,
        body: {
          ok: true,
          signers: states.map((s) => ({
            idx: s.idx,
            papel: s.papel,
            label: labelOf(ctx.signers, s.idx),
            nome: s.nome,
            email: s.emailMasked,
            signed: s.signed,
            found: !!s.signerId,
            editable: !s.signed && !!s.signerId && EDITABLE_PAPEIS.has(s.papel),
          })),
        },
      };
    } catch (e) {
      const code = e instanceof ClicksignError ? `${e.step}:${e.status}` : "internal";
      return fail(502, "Não foi possível consultar a Clicksign agora. Tente de novo.", { code });
    }
  }

  if (action === "notify") {
    const lock = await deps.lock(auth.envelope, "notify");
    if (lock === "cooldown") {
      return fail(
        429,
        `O aviso foi reenviado há pouco. Aguarde ${NOTIFY_COOLDOWN_MIN} minutos entre um reenvio e outro.`,
      );
    }
    if (lock === "busy") return fail(409, "Outra ação está em andamento neste envelope. Aguarde.");
    const err = await notifySigners(client, ctx.envelopeKey);
    const partial = err === "notify:partial";
    if (err && !partial) {
      await deps.done(auth.envelope, { action: null }).catch(() => undefined);
      return fail(
        502,
        "A Clicksign não confirmou o reenvio do aviso. Tente de novo em instantes.",
        {
          code: `notify_failed:${err}`,
        },
      );
    }
    await deps
      .done(auth.envelope, {
        action: "clicksign_aviso",
        detail: `Aviso reenviado pela Clicksign a quem ainda não assinou${ctx.isTest ? " (TESTE)" : ""}${partial ? "; a Clicksign não avisou todos" : ""}`,
        notified: true,
      })
      .catch(() => undefined);
    return {
      status: 200,
      body: {
        ok: true,
        ...(partial ? { warning: "A Clicksign reenviou, mas não conseguiu avisar todos." } : {}),
      },
    };
  }

  // ---------- edit_signer ----------
  const idx = typeof b.idx === "number" && Number.isInteger(b.idx) ? b.idx : -1;
  const nome = normName(typeof b.nome === "string" ? b.nome.slice(0, 200) : "");
  const email = normEmail(typeof b.email === "string" ? b.email.slice(0, 200) : "");
  const target = ctx.signers[idx];
  if (!target) return fail(422, "Signatário inválido");
  const label = labelOf(ctx.signers, idx);
  if (!EDITABLE_PAPEIS.has(target.papel)) {
    return fail(
      422,
      target.papel === "corretor"
        ? "O e-mail do corretor vem do cadastro do captador: corrija no cadastro do usuário."
        : "Quem assina pela imobiliária vem da lista autorizada: peça ao administrador.",
    );
  }
  const errors: string[] = [];
  if (!validSignerName(nome)) errors.push(`${label}: informe nome e sobrenome`);
  if (!validEmail(email)) errors.push(`${label}: e-mail ausente ou inválido`);
  if (errors.length) return fail(422, "Dados inválidos", { details: errors });
  const sha = await sha256Hex(email);
  if (sha === target.email_sha256 && nome === normName(target.nome)) {
    return fail(422, "Nada mudou: informe o nome ou o e-mail corrigido");
  }
  const dup = ctx.signers.findIndex((s, i) => i !== idx && s.email_sha256 === sha);
  if (dup >= 0) {
    return fail(422, "Dados inválidos", {
      details: [
        `A mesma pessoa não pode assinar duas vezes (${labelOf(ctx.signers, dup)} e ${label})`,
      ],
    });
  }
  if (ctx.testMode && !ctx.allowlistSha256.includes(sha)) {
    return fail(422, "Modo teste: o e-mail novo está fora da lista autorizada de teste", {
      details: ["No modo teste só e-mails da allowlist da imobiliária podem receber"],
    });
  }

  const lock = await deps.lock(auth.envelope, "edit");
  if (lock !== "ok") return fail(409, "Outra ação está em andamento neste envelope. Aguarde.");
  const release = () => deps.done(auth.envelope, { action: null }).catch(() => undefined);

  // 1) Confere na Clicksign: o signatário existe e ainda não assinou.
  let oldId: string;
  let oldReqs: string[];
  try {
    const states = await readStates(client, ctx);
    const st = states[idx];
    if (st.signed) {
      await release();
      return fail(409, `${label} já assinou: não é possível alterar.`);
    }
    if (!st.signerId) {
      await release();
      return fail(
        409,
        `${label} não foi encontrado no envelope da Clicksign (pode ter sido alterado lá). Confira na Clicksign.`,
      );
    }
    oldId = st.signerId;
    oldReqs = requirementIdsFor(
      await client.listRequirements(ctx.envelopeKey),
      oldId,
      ctx.documentKey,
    );
    if (!oldReqs.length) {
      await release();
      return fail(409, `${label}: requisitos não encontrados na Clicksign. Confira na Clicksign.`);
    }
  } catch (e) {
    await release();
    const code = e instanceof ClicksignError ? `${e.step}:${e.status}` : "internal";
    return fail(502, "Não foi possível consultar a Clicksign. Nada foi alterado.", { code });
  }

  // 2) Cria o signatário novo e troca os requisitos numa operação atômica (bulk_requirements).
  let newId: string;
  try {
    const created = await client.addSigner(ctx.envelopeKey, { nome, email });
    newId = String(created?.data?.id ?? "");
    if (!newId) throw new ClicksignError("signer", 0, "resposta sem id");
  } catch (e) {
    await release();
    const code = e instanceof ClicksignError ? `${e.step}:${e.status}` : "internal";
    const detail = e instanceof ClicksignError && e.status === 422 ? e.detail : undefined;
    return fail(502, "A Clicksign recusou o signatário novo. Nada foi alterado.", {
      code,
      ...(detail ? { details: [detail] } : {}),
    });
  }
  const rel = {
    document: { data: { type: "documents", id: ctx.documentKey } },
    signer: { data: { type: "signers", id: newId } },
  };
  try {
    await client.bulkRequirements(ctx.envelopeKey, [
      ...oldReqs.map((id) => ({ op: "remove", ref: { type: "requirements", id } })),
      {
        op: "add",
        data: {
          type: "requirements",
          attributes: { action: "agree", role: ROLE_BY_PAPEL[target.papel] },
          relationships: rel,
        },
      },
      {
        op: "add",
        data: {
          type: "requirements",
          attributes: { action: "provide_evidence", auth: "email" },
          relationships: rel,
        },
      },
    ]);
  } catch (e) {
    // Operação atômica falhou: o antigo continua valendo. Remove o novo (sem requisitos) e sai.
    await client.deleteSigner(ctx.envelopeKey, newId).catch(() => undefined);
    await release();
    const code = e instanceof ClicksignError ? `${e.step}:${e.status}` : "internal";
    return fail(502, "A Clicksign não aceitou a troca. Nada foi alterado.", { code });
  }

  // 3) Daqui em diante a troca JÁ valeu na Clicksign: nada é revertido; falhas viram aviso.
  const warnings: string[] = [];
  const oldDeleted = await client.deleteSigner(ctx.envelopeKey, oldId).then(
    () => true,
    () => false,
  );
  if (!oldDeleted) {
    warnings.push(
      "O signatário antigo ficou no envelope sem poder assinar; remova-o na Clicksign se aparecer.",
    );
  }
  const notifyErr = await notifySigners(client, ctx.envelopeKey);
  const notified = !notifyErr || notifyErr === "notify:partial";
  if (!notified) warnings.push("Não foi possível avisar o novo signatário: use “Reenviar aviso”.");

  const nextSigners = ctx.signers.map((s, i) =>
    i === idx ? { papel: s.papel, nome, email_sha256: sha } : s,
  );
  const mudou = [
    normName(target.nome) !== nome ? `nome: ${normName(target.nome)} → ${nome}` : null,
    sha !== target.email_sha256 ? "e-mail corrigido" : null,
  ]
    .filter(Boolean)
    .join("; ");
  try {
    await deps.done(auth.envelope, {
      action: "clicksign_signatario",
      detail: `${label} alterado na Clicksign (${mudou})${ctx.isTest ? " (TESTE)" : ""}${notified ? "; aviso enviado" : "; aviso NÃO enviado"}`,
      signers: nextSigners,
      notified,
    });
  } catch {
    warnings.push(
      "A troca foi feita na Clicksign, mas o registro no ADM MAX falhou. Avise o suporte.",
    );
  }
  return {
    status: 200,
    body: {
      ok: true,
      email: maskEmail(email),
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
    },
  };
}
