import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: "./server",
  experimental: {
    tasks: true,
  },
  scheduledTasks: {
    "*/5 * * * *": ["room-reservation-reminders"],
  },
});
