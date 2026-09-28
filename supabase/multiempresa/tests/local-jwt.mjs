// Gera segredo/JWT efêmeros SOMENTE para o PostgREST local do clone descartável.
// Uso: node local-jwt.mjs secret | node local-jwt.mjs token <arquivo-segredo> [role]
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const [mode, secretFile, role = "service_role"] = process.argv.slice(2);
if (mode === "secret") {
  process.stdout.write(randomBytes(32).toString("hex"));
} else if (mode === "token") {
  const secret = readFileSync(secretFile, "utf8").trim();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role, iss: "adm-mt-local", exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  process.stdout.write(`${head}.${body}.${sig}`);
} else {
  process.stderr.write("uso: local-jwt.mjs secret | token <arquivo> [role]\n");
  process.exit(2);
}
