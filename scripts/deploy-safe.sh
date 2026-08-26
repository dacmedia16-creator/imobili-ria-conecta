#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_REMOTE="https://github.com/dacmedia16-creator/imobili-ria-conecta.git"
EXPECTED_BRANCH="main"
EXPECTED_WORKER="imobili-ria-conecta"
PRODUCTION_URL="https://unicaescolha.com.br"
CHECK_ONLY=false

if [[ "${1:-}" == "--check-only" ]]; then
  CHECK_ONLY=true
elif [[ $# -gt 0 ]]; then
  echo "Uso: npm run deploy:safe ou npm run deploy:check" >&2
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
cd "${PROJECT_DIR}"

fail() {
  echo "DEPLOY BLOQUEADO: $*" >&2
  exit 1
}

echo "[1/8] Validando projeto oficial"
[[ "${PROJECT_DIR}" != /tmp/* ]] || fail "o projeto está em uma pasta temporária (${PROJECT_DIR})."
[[ -f package.json && -f package-lock.json && -f wrangler.toml ]] || fail "arquivos do projeto oficial não encontrados."
[[ "$(git rev-parse --show-toplevel)" == "${PROJECT_DIR}" ]] || fail "execute a partir da raiz do repositório oficial."
[[ "$(git remote get-url origin)" == "${EXPECTED_REMOTE}" ]] || fail "o remote origin não é o repositório oficial."
[[ "$(git branch --show-current)" == "${EXPECTED_BRANCH}" ]] || fail "a branch atual não é ${EXPECTED_BRANCH}."
grep -Eq '^name = "imobili-ria-conecta"$' wrangler.toml || fail "o Worker configurado não é ${EXPECTED_WORKER}."

echo "[2/8] Verificando alterações locais"
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || fail "existem alterações locais sem commit. Faça commit e sincronize antes de publicar."

echo "[3/8] Sincronizando referência do GitHub"
git fetch --prune origin "${EXPECTED_BRANCH}"
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "origin/${EXPECTED_BRANCH}")"
[[ "${LOCAL_HEAD}" == "${REMOTE_HEAD}" ]] || fail "o código local diverge do GitHub. Local ${LOCAL_HEAD:0:8}; GitHub ${REMOTE_HEAD:0:8}."

echo "[4/8] Instalando dependências reproduzíveis"
npm ci

echo "[5/8] Executando testes"
npm test

echo "[6/8] Gerando build"
npm run build

echo "[7/8] Verificando funções críticas no build"
for marker in "especialistas" "meu-posicionamento" "vendas" "financeiro"; do
  grep -RqsF -- "${marker}" .output/public .output/server \
    || fail "a função crítica '${marker}' não foi encontrada no build."
done

if [[ "${CHECK_ONLY}" == true ]]; then
  echo "CHECK APROVADO: commit ${LOCAL_HEAD} está pronto para publicação segura."
  exit 0
fi

echo "[8/8] Publicando commit ${LOCAL_HEAD}"
PREVIOUS_VERSION="$(npx wrangler deployments status --json 2>/dev/null | node -e '
let input=""; process.stdin.on("data", d => input += d); process.stdin.on("end", () => {
  try {
    const data=JSON.parse(input);
    const versions=data.versions || data.deployment?.versions || [];
    process.stdout.write(versions[0]?.version_id || versions[0]?.id || "");
  } catch {}
});')"

npm run deploy

smoke_test() {
  curl --fail --silent --show-error --location --max-time 30 "${PRODUCTION_URL}/" >/dev/null \
    && curl --fail --silent --show-error --location --max-time 30 "${PRODUCTION_URL}/especialistas" >/dev/null
}

if ! smoke_test; then
  echo "A validação de produção falhou." >&2
  if [[ -n "${PREVIOUS_VERSION}" ]]; then
    echo "Revertendo automaticamente para ${PREVIOUS_VERSION}." >&2
    npx wrangler rollback "${PREVIOUS_VERSION}" --name "${EXPECTED_WORKER}" --yes \
      --message "Rollback automático: smoke test falhou após ${LOCAL_HEAD}"
  else
    echo "Não foi possível identificar automaticamente a versão anterior para rollback." >&2
  fi
  exit 1
fi

mkdir -p .deploy
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${LOCAL_HEAD}" "${PRODUCTION_URL}" >> .deploy/history.log
echo "DEPLOY APROVADO: commit ${LOCAL_HEAD} publicado e validado em ${PRODUCTION_URL}."
