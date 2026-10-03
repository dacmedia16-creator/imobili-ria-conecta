import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: "./server",
  experimental: {
    tasks: true,
  },
  scheduledTasks: {
    "*/5 * * * *": ["room-reservation-reminders"],
    // Segunda-feira 8h (São Paulo = 11h UTC): vencimentos das exclusividades.
    "0 11 * * 1": ["exclusive-expiry-alerts"],
  },
});
