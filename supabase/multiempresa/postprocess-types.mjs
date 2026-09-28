#!/usr/bin/env node
// Pós-processa src/integrations/supabase/types.ts gerado do banco multiempresa.
// `organization_id` é NOT NULL sem DEFAULT, mas o banco o preenche por gatilho (agência do JWT ou do
// registro pai). No Insert ele é opcional para o cliente com JWT de usuário; com service_role o
// gatilho exige o valor explícito (marco 1d) e as rotinas de servidor já o informam.
// Uso: node supabase/multiempresa/postprocess-types.mjs src/integrations/supabase/types.ts
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const src = readFileSync(file, "utf8");
let inInsert = false;
let depth = 0;
let changed = 0;
const out = src.split("\n").map((line) => {
  if (/^\s*Insert: \{\s*$/.test(line)) {
    inInsert = true;
    depth = 1;
    return line;
  }
  if (inInsert) {
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth <= 0) inInsert = false;
    else if (/^\s*organization_id: string;?\s*$/.test(line)) {
      changed += 1;
      return line.replace("organization_id:", "organization_id?:");
    }
  }
  return line;
});
writeFileSync(file, out.join("\n"));
console.log(`organization_id opcional em ${changed} blocos Insert`);
