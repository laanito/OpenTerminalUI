#!/usr/bin/env sh
set -eu

# This destructive teardown is safe only on an ephemeral GitHub-hosted runner.
# A self-hosted deployment runner must never satisfy this guard.
if [ "${GITHUB_ACTIONS:-}" != "true" ] || [ "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ]; then
  echo "Clean-install verification may run only on a GitHub-hosted Actions runner."
  exit 2
fi
case "${GITHUB_RUN_ID:-}" in
  ''|*[!0-9]*)
    echo "Clean-install verification requires a numeric GitHub run ID."
    exit 2
    ;;
esac

PROJECT_NAME="openterminalui-clean-install-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
export COMPOSE_PROJECT_NAME="$PROJECT_NAME"
export APP_PORT="18080"
export POSTGRES_PORT="15432"
export POSTGRES_DB="openterminalui_clean_install_ci"
export POSTGRES_USER="openterminalui_clean_install_ci"
export POSTGRES_PASSWORD="clean-install-ci-only"
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"
export REDIS_URL="redis://redis:6379/0"
export OPENTERMINALUI_ENV="production"
export JWT_SECRET_KEY="clean-install-ci-jwt-secret-not-for-production"
export CACHE_SIGNING_KEY="clean-install-ci-cache-secret-not-for-production"
export OPENTERMINALUI_INSTRUMENT_AUTOSEED="0"
export OPENTERMINALUI_INSTRUMENT_LIVE_SEARCH="0"
export OPENTERMINALUI_BINANCE_WS_ENABLED="false"
export OPENTERMINALUI_PREFETCH_ENABLED="0"
export LLM_ENABLED="false"

compose() {
  docker compose --env-file .env.example --project-name "$PROJECT_NAME" "$@"
}

cleanup() {
  status="$?"
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ]; then
    compose ps || true
    compose logs --no-color || true
  fi
  compose down --volumes --remove-orphans || true
  exit "$status"
}
trap cleanup EXIT INT TERM

compose config --quiet
compose up --build --wait --wait-timeout 300

health_payload="$(curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/health")"
case "$health_payload" in
  *'"status":"ok"'*) ;;
  *)
    echo "Unexpected health response: $health_payload"
    exit 1
    ;;
esac

curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/" | grep --quiet '<div id="root"'
curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/docs" | grep --quiet 'swagger-ui'
curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/openapi.json" | grep --quiet 'x-openterminalui-auth-contract'
curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/healthz" | grep --quiet '"status":"ok"'
curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/metrics-lite" | grep --quiet '"ws_clients"'

register_payload="$(
  curl --fail --silent --show-error \
    --header 'Content-Type: application/json' \
    --data '{"email":"clean-install@example.test","password":"clean-install-password"}' \
    "http://127.0.0.1:${APP_PORT}/api/auth/register"
)"
case "$register_payload" in
  *'"email":"clean-install@example.test"'*) ;;
  *)
    echo "Fresh-database registration returned an unexpected response."
    exit 1
    ;;
esac

curl --fail --silent --show-error \
  --header 'Content-Type: application/json' \
  --data '{"email":"clean-install@example.test","password":"clean-install-password"}' \
  "http://127.0.0.1:${APP_PORT}/api/auth/login" | grep --quiet '"access_token"'

migration_revision="$(
  compose exec -T postgres psql \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --tuples-only \
    --no-align \
    --command 'SELECT version_num FROM alembic_version;'
)"
if [ -z "$migration_revision" ]; then
  echo "Fresh PostgreSQL database has no Alembic revision."
  exit 1
fi

echo "Clean install healthy; Alembic revision: $migration_revision"
