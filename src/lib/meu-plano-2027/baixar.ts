import { loadCurrentAgencyBrand, logoForPdf } from "@/lib/agency-brand";
import { ANO_PLANO } from "./telas";
import type { Respostas } from "./regras";
import { erroPlano, planoDb } from "./modulo";
import { nomeArquivoPlano, type PlanoPdfDados } from "./pdf-conteudo";

/**
 * Baixa o PDF do plano de `userId` (cartão t_65edd0b0). Lê o plano DIRETO da tabela carreira_plano, pela RLS de
 * quem está logado: corretor = o próprio; gestor/admin = a imobiliária; team leader = a própria equipe. Quem não
 * tem acesso recebe 0 linhas e o PDF não sai. O PDF é montado no navegador (pdf-lib), nada é gravado.
 */
export async function baixarPlanoPdf(userId: string, nome?: string | null): Promise<void> {
  const [p, t, n] = await Promise.all([
    planoDb
      .from("carreira_plano")
      .select(
        "respostas,ativacao_inicio,assinado_corretor_em,assinado_broker_em,meta_oficial,meta_oficial_em",
      )
      .eq("user_id", userId)
      .eq("ano", ANO_PLANO)
      .maybeSingle(),
    planoDb
      .from("carreira_taxas")
      .select("funil_v2_cre,funil_v1_v2,funil_folga")
      .is("user_id", null)
      .maybeSingle(),
    nome
      ? Promise.resolve(null)
      : planoDb.from("profiles").select("nome").eq("id", userId).maybeSingle(),
  ]);
  if (p.error) throw new Error(erroPlano(p.error.message));
  if (!p.data)
    throw new Error("Plano não encontrado: ainda não foi começado ou você não tem acesso.");
  const plano = { ...(p.data as PlanoPdfDados), respostas: (p.data.respostas ?? {}) as Respostas };
  const tx = t.data as {
    funil_v2_cre: number | null;
    funil_v1_v2: number | null;
    funil_folga: number | null;
  } | null;
  const colaborador = nome ?? (n?.data as { nome?: string } | null)?.nome ?? "";
  const brand = await loadCurrentAgencyBrand();
  const logo = await logoForPdf(brand?.pdfLogoUrl ?? null);
  const { buildPlanoPdf } = await import("./pdf");
  const bytes = await buildPlanoPdf({
    plano,
    colaborador,
    taxasPadrao: tx
      ? {
          v2cre: tx.funil_v2_cre == null ? null : Number(tx.funil_v2_cre),
          v1v2: tx.funil_v1_v2 == null ? null : Number(tx.funil_v1_v2),
          folga: tx.funil_folga == null ? null : Number(tx.funil_folga),
        }
      : null,
    agencyName: brand?.nome ?? null,
    logoPng: logo,
  });
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivoPlano(colaborador);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
