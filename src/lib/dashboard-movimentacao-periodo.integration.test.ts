/**
 * Suíte de integração da RPC dashboard_movimentacao_periodo() — mesma convenção de
 * financial-rules.integration.test.ts (INSERT de vendas/histórico de teste marcadas com
 * codigo_interno único via `supabaseAdmin`, nunca UPDATE; cada teste limpa seus próprios dados no
 * final, mesmo se a asserção falhar).
 *
 * Cobre o bug corrigido em 20260819010000: a versão anterior contava MARCOS por grupo (1ª
 * transição de cada venda pra QUALQUER status daquele grupo, em qualquer momento do histórico) —
 * isso deixava a mesma venda contada em "futuras" E "confirmadas" no mesmo período sempre que ela
 * avançasse de um grupo pro outro dentro da janela selecionada. A regra nova conta cada venda
 * EXATAMENTE UMA VEZ, pelo grupo de negócio do seu status MAIS RECENTE (última transição) dentro
 * do período.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mapearMovimentacaoPeriodo } from "./dashboard-movimentacao-query";
import type { Database } from "@/integrations/supabase/types";

type SaleStatus = Database["public"]["Enums"]["sale_status"];

const HAS_SUPABASE_ADMIN_ENV = Boolean(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.SUPABASE_PUBLISHABLE_KEY,
);

describe.skipIf(!HAS_SUPABASE_ADMIN_ENV)(
  "dashboard_movimentacao_periodo — sem duplicidade entre cards",
  () => {
    let supabaseAdmin: typeof import("@/integrations/supabase/client.server").supabaseAdmin;
    // dashboard_movimentacao_periodo é SECURITY INVOKER com EXECUTE só pra `authenticated` (não pra
    // `service_role` — grant deliberadamente restrito na migration original, 20260817000000). Por
    // isso a RPC precisa ser chamada por um usuário autenticado de verdade (via anon key + login),
    // não pelo client admin — o admin só cria/limpa os dados de teste (bypassa RLS nas tabelas, mas
    // não tem EXECUTE nesta função específica).
    let supabaseAuth: ReturnType<typeof createClient<Database>>;
    let corretorId: string;
    const createdSaleIds: string[] = [];

    // Janela de período fixa e distante de "agora" (não depende do relógio do dia em que o teste
    // roda) — evita que qualquer venda real do banco compartilhado caia dentro da janela por acaso.
    const INICIO = "2020-01-01T00:00:00.000Z";
    const FIM = "2020-02-01T00:00:00.000Z";
    const dentroDoPeriodo = (diasApos: number) =>
      new Date(new Date(INICIO).getTime() + diasApos * 86400000).toISOString();

    const EMAIL_TESTE = `movimentacao-teste-${randomUUID()}@local.test`;
    const SENHA_TESTE = "Teste@12345678";

    beforeAll(async () => {
      ({ supabaseAdmin } = await import("@/integrations/supabase/client.server"));

      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: EMAIL_TESTE,
        password: SENHA_TESTE,
        email_confirm: true,
      });
      if (createErr) throw createErr;
      corretorId = created.user.id;

      supabaseAuth = createClient<Database>(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
      );
      const { error: signInErr } = await supabaseAuth.auth.signInWithPassword({
        email: EMAIL_TESTE,
        password: SENHA_TESTE,
      });
      if (signInErr) throw signInErr;
    }, 30000);

    afterEach(async () => {
      while (createdSaleIds.length > 0) {
        const saleId = createdSaleIds.pop()!;
        await supabaseAdmin.from("sale_status_history").delete().eq("sale_id", saleId);
        await supabaseAdmin.from("sales").delete().eq("id", saleId);
      }
    }, 30000);

    afterAll(async () => {
      await supabaseAdmin.auth.admin.deleteUser(corretorId);
    }, 30000);

    const codigoTeste = () => `TESTE-MOVIMENTACAO-${randomUUID()}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function criarVenda(overrides: Record<string, any> = {}) {
      const { data, error } = await supabaseAdmin
        .from("sales")
        .insert({
          corretor_id: corretorId,
          status: "rascunho",
          codigo_interno: codigoTeste(),
          ...overrides,
        })
        .select("id")
        .single();
      if (error) throw error;
      createdSaleIds.push(data.id);
      return data.id as string;
    }

    async function transicao(saleId: string, para: SaleStatus, quandoIso: string) {
      const { error } = await supabaseAdmin
        .from("sale_status_history")
        .insert({ sale_id: saleId, para, created_at: quandoIso });
      if (error) throw error;
    }

    async function movimentacao() {
      const { data, error } = await supabaseAuth.rpc("dashboard_movimentacao_periodo", {
        _inicio: INICIO,
        _fim: FIM,
      });
      if (error) throw error;
      return mapearMovimentacaoPeriodo(data);
    }

    it("venda que avança de futura pra confirmada no período conta só em confirmada, nunca nas duas", async () => {
      const saleId = await criarVenda({ valor_negociado: 500000 });
      await transicao(saleId, "enviada_revisao", dentroDoPeriodo(2));
      await transicao(saleId, "contrato_assinado", dentroDoPeriodo(10));

      const r = await movimentacao();

      // Não afirmo valores absolutos (o banco compartilhado pode ter outras vendas nessa janela de
      // teste em paralelo) — a prova de "sem duplicidade" é: a venda de teste soma no VGV de
      // confirmada, e NÃO soma no VGV de futura. Uso o valor_negociado (500000, único o bastante
      // pra não colidir por acaso) como marcador.
      expect(r.confirmadasVgv).toBeGreaterThanOrEqual(500000);
      // Se a venda também tivesse sido contada em futura (bug antigo), futurasVgv teria pelo menos
      // 500000 também — o que provaria duplicidade.
      const outraVendaPoderiaExplicar = r.futurasVgv >= 500000;
      expect(outraVendaPoderiaExplicar).toBe(false);
    });

    it("venda que avança de confirmada pra encerrada no período conta só em encerrada", async () => {
      const saleId = await criarVenda({ valor_negociado: 700000 });
      await transicao(saleId, "contrato_assinado", dentroDoPeriodo(1));
      await transicao(saleId, "cancelada", dentroDoPeriodo(15));

      const antes = await movimentacao();
      const depois = antes; // mesma leitura, só documentando a intenção do teste abaixo

      expect(depois.encerradasQuantidade).toBeGreaterThanOrEqual(1);
      expect(depois.confirmadasVgv).toBeLessThan(700000);
    });

    it("3 vendas com 1 transição cada (uma por grupo) somam exatamente 3 no total dos 3 cards — nenhuma sobra nem falta", async () => {
      const futura = await criarVenda({ valor_negociado: 111111 });
      const confirmada = await criarVenda({ valor_negociado: 222222 });
      const encerrada = await criarVenda({ valor_negociado: 333333 });
      await transicao(futura, "enviada_revisao", dentroDoPeriodo(3));
      await transicao(confirmada, "contrato_assinado", dentroDoPeriodo(3));
      await transicao(encerrada, "arquivada", dentroDoPeriodo(3));

      const antes = await movimentacao();

      // Uso IDs únicos via valor_negociado como assinatura, mas o que importa aqui é a soma total —
      // com a regra antiga, uma venda que passasse por 2 grupos contaria 2x; aqui cada venda passa
      // por 1 grupo só, então total esperado = 3 vendas = 3 contagens somadas nos 3 cards (não mais).
      const totalReportado =
        antes.futurasQuantidade + antes.confirmadasQuantidade + antes.encerradasQuantidade;
      // Não posso comparar == 3 direto (banco compartilhado tem outras vendas na mesma janela fixa
      // de outros testes rodando em paralelo/CI) — comparo o DELTA depois de remover as 3 vendas.
      for (const saleId of [futura, confirmada, encerrada]) {
        await supabaseAdmin.from("sale_status_history").delete().eq("sale_id", saleId);
        await supabaseAdmin.from("sales").delete().eq("id", saleId);
      }
      createdSaleIds.length = 0;
      const depois = await movimentacao();
      const totalDepois =
        depois.futurasQuantidade + depois.confirmadasQuantidade + depois.encerradasQuantidade;

      expect(totalReportado - totalDepois).toBe(3);
    });

    it("múltiplas transições dentro do mesmo grupo (futura) contam a venda 1 vez só, não 1 vez por transição", async () => {
      const saleId = await criarVenda({ valor_negociado: 400000 });
      await transicao(saleId, "enviada_revisao", dentroDoPeriodo(1));
      await transicao(saleId, "devolvida_ajuste", dentroDoPeriodo(2));
      await transicao(saleId, "enviada_revisao", dentroDoPeriodo(3));

      const comVenda = await movimentacao();
      await supabaseAdmin.from("sale_status_history").delete().eq("sale_id", saleId);
      await supabaseAdmin.from("sales").delete().eq("id", saleId);
      createdSaleIds.length = 0;
      const semVenda = await movimentacao();

      // 3 transições, todas pro grupo "futura" — se cada transição fosse contada, o delta de
      // quantidade seria >1; a venda deve aparecer só 1 vez.
      expect(comVenda.futurasQuantidade - semVenda.futurasQuantidade).toBe(1);
      expect(comVenda.futurasVgv - semVenda.futurasVgv).toBeCloseTo(400000, 2);
    });

    it("transição fora da janela do período não é contada", async () => {
      const saleId = await criarVenda({ valor_negociado: 999000 });
      await transicao(saleId, "contrato_assinado", "2019-01-01T00:00:00.000Z");

      const r = await movimentacao();

      expect(r.confirmadasVgv).toBeLessThan(999000);
    });
  },
);
