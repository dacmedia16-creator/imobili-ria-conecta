import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: "./server",
  experimental: {
    tasks: true,
  },
  scheduledTasks: {
    // A cada 5 min: lembretes de sala e WhatsApp dos avisos da Clicksign (inclui o lembrete de
    // prazo, que o banco só libera das 9h às 20h de Brasília, 3 dias antes do vencimento).
    // leads-ia-espera (t_82c89141): resposta de espera da Nicole depois do repasse ao corretor.
    "*/5 * * * *": ["room-reservation-reminders", "clicksign-avisos", "leads-ia-espera"],
    // Segunda-feira 8h (São Paulo = 11h UTC): vencimentos das exclusividades.
    "0 11 * * 1": ["exclusive-expiry-alerts"],
    // Todo dia 3h20 (São Paulo = 6h20 UTC): anúncios do site RE/MAX. Só coleta com REMAX_SITE_COLLECT=on.
    "20 6 * * *": ["remax-site-collect"],
    // 6h40 UTC: XML RE/MAX -> OLX (venda), base do Feedback e do mapa; só com REMAX_XML_COLLECT=on.
    "40 6 * * *": ["remax-xml-collect"],
    // 2x por dia, 8h15 e 14h15 de Brasília (11h15 e 17h15 UTC): links "Link do XML (portais)" cadastrados
    // na tela, modo genérico (t_76243950; horário t_b9e3d429). Mesma chave REMAX_XML_COLLECT=on.
    "15 11,17 * * *": ["xml-feed-collect"],
    // A cada 30 min: alertas de Oportunidades (dry-run; só envia com OPORTUNIDADES_ALERTAS=on).
    "*/30 * * * *": ["opportunity-alerts"],
  },
});
