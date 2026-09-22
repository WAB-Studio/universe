#!/usr/bin/env bash
# One parallel track: a worktree, its own lane, its own port.
#
#   scripts/worktree.sh 2 mi-rama [base] [--app orbit]
#
# Lane N lands beside this checkout as <checkout>-lN on its app's port base plus
# N-1, with its own Playwright artefacts. A lane's app decides whether it has a
# database at all, so the environment file and the pair of harness identities are
# facts in the table below and not steps every lane runs: an app without a
# database opens a lane with the remote Postgres unreachable. The apps that do
# have one share that single Postgres, so run at most three of their suites at a
# time.
set -euo pipefail

# app       port base  .env.local  harness identities
APPS=(
  "orbit    3000       yes         yes"
  "voyager  3100       yes         no"
  "pulsar   3200       yes         no"
)

APP_NAME=orbit
ARGS=()
while (($#)); do
  case $1 in
    --app) APP_NAME=${2:?app name after --app}; shift 2 ;;
    --app=*) APP_NAME=${1#--app=}; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

LANE=${ARGS[0]:?lane number, 2 or higher}
BRANCH=${ARGS[1]:?branch name}
BASE=${ARGS[2]:-integracion}

PORT_BASE=
for row in "${APPS[@]}"; do
  read -r name port_base copies_env has_harness <<<"$row"
  if [[ $name == "$APP_NAME" ]]; then
    PORT_BASE=$port_base
    COPIES_ENV=$copies_env
    HAS_HARNESS=$has_harness
  fi
done
if [[ -z $PORT_BASE ]]; then
  { printf 'worktree.sh: no app named %s. This monorepo has:' "$APP_NAME"
    for row in "${APPS[@]}"; do printf ' %s' "${row%% *}"; done
    printf '\n'
  } >&2
  exit 1
fi

ROOT=$(git rev-parse --show-toplevel)
# Derived from the checkout's own name, so renaming the repo never strands a lane.
DIR=$(dirname "$ROOT")/$(basename "$ROOT")-l$LANE
APP=$DIR/apps/$APP_NAME
PORT=$((PORT_BASE + LANE - 1))

cd "$ROOT"

# Read the base rather than this checkout: an app may exist only on the branch
# the lane will serve. Both checks run before anything is created, so a base or
# an app that is not there leaves no half-made lane behind.
if ! git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null; then
  echo "worktree.sh: no base named $BASE." >&2
  exit 1
fi
if ! git rev-parse --verify --quiet "$BASE:apps/$APP_NAME" >/dev/null 2>&1; then
  echo "worktree.sh: $BASE has no apps/$APP_NAME." >&2
  exit 1
fi

git worktree add -b "$BRANCH" "$DIR" "$BASE"

# Hardlinks, not a symlink: Turbopack refuses a node_modules that points out of
# the filesystem root, and a copy would cost 909 MB a lane. Workspaces hoist to
# the monorepo root, so this one tree covers every app.
cp -al node_modules "$DIR/node_modules"
if [[ $COPIES_ENV == yes ]]; then
  cp "apps/$APP_NAME/.env.local" "$APP/.env.local"
fi
# `private/` is gitignored, so the worktree is born without the plans a dispatch
# names. Reports stay behind: the lane writes its own and it is copied out.
mkdir -p "$DIR/private/planes" "$DIR/private/reportes"
cp private/planes/*.md "$DIR/private/planes/"

# Once per worktree, and never with that worktree's dev server up: typegen and
# `next dev` race over .next/dev/types.
(cd "$APP" && npx next typegen >/dev/null)

# The lane's two identities and their token rows. Idempotent: a lane already
# bootstrapped just lands a fresh session.
if [[ $HAS_HARNESS == yes ]]; then
  (cd "$APP" && HARNESS_LANE="$LANE" npm run harness:token)
fi

case $APP_NAME in
  orbit)
    COMMANDS="  cd $APP
  PORT=$PORT npm run dev
  HARNESS_LANE=$LANE HARNESS_BASE_URL=http://localhost:$PORT npm run check:e2e" ;;
  # Voyager's suite counts effects, and `next dev` runs them twice under
  # StrictMode, so `dev` hands back 13 red specs that a build passes. Its
  # config says so at the top; printing `dev` here next to the suite line is
  # what made two lanes believe it. Build, serve, and rebuild after every edit
  # — `start` serves the build, not the tree.
  voyager)
    COMMANDS="  cd $DIR
  npm run build -w apps/$APP_NAME
  PORT=$PORT npm run start -w apps/$APP_NAME
  ${APP_NAME^^}_BASE_URL=http://localhost:$PORT npm run check:e2e -w apps/$APP_NAME" ;;
  # An app with no harness has no lane to name, so its suite takes the port alone.
  *)
    COMMANDS="  cd $DIR
  PORT=$PORT npm run dev -w apps/$APP_NAME
  ${APP_NAME^^}_BASE_URL=http://localhost:$PORT npm run check:e2e -w apps/$APP_NAME" ;;
esac

cat <<EOF

Lane $LANE ready at $DIR on branch $BRANCH.

$COMMANDS

Drop it when the branch lands:

  git worktree remove $DIR --force
EOF
