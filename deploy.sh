#!/usr/bin/env bash
# Publish The Last Leaf to Betacade.
#   ./deploy.sh
# Requires: curl, python3, tar (all ship with macOS).
#
# First run signs in through the browser and stores a token in
# ~/.config/betacade/token (outside the repo, never uploaded).
# The game id is kept in .betacade-game (dot-files are excluded from builds).

set -euo pipefail

API="https://api.betacade.com"
GAME_NAME="The Last Leaf"
ROOT="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="$HOME/.config/betacade/token"
GAME_FILE="$ROOT/.betacade-game"
BUILD_FILES=(index.html style.css betacade.js src assets art)

# --- helpers -----------------------------------------------------------------

# Find a key anywhere in the JSON on stdin and print its value ("" if absent).
json_get() {
  python3 -I -c '
import json, sys
def find(o, k):
    if isinstance(o, dict):
        if k in o: return o[k]
        o = list(o.values())
    if isinstance(o, list):
        for v in o:
            r = find(v, k)
            if r is not None: return r
    return None
try:
    v = find(json.load(sys.stdin), sys.argv[1])
except Exception:
    v = None
if v is None: v = ""
print(v if isinstance(v, (str, int, float)) else json.dumps(v))
' "$1"
}

# api METHOD PATH [JSON_BODY] [extra curl args...]  -> sets RESP and STATUS
api() {
  local method="$1" path="$2" body="${3:-}"
  shift $(( $# >= 3 ? 3 : $# ))
  local args=(-sS -X "$method" "$API$path" -H "Accept: application/json" -w $'\n%{http_code}')
  [[ -n "${TOKEN:-}" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" --data "$body")
  local out
  out="$(curl "${args[@]}" "$@")"
  STATUS="${out##*$'\n'}"
  RESP="${out%$'\n'*}"
}

fail() {
  echo "error: $1" >&2
  [[ -n "${RESP:-}" ]] && echo "response ($STATUS): $RESP" >&2
  exit 1
}

# --- 1. sign in (once) -------------------------------------------------------

sign_in() {
  TOKEN=""
  api POST /v1/device/authorize '{"clientName":"The Last Leaf deploy.sh"}'
  [[ "$STATUS" == 200 ]] || fail "could not start sign-in"
  local device_code interval url code
  device_code="$(json_get deviceCode <<<"$RESP")"
  interval="$(json_get interval <<<"$RESP")"
  url="$(json_get verificationUrl <<<"$RESP")"
  code="$(json_get userCode <<<"$RESP")"

  echo "Approve this device in your browser:"
  echo "  $url"
  echo "  code: $code"
  open "$url" 2>/dev/null || true

  while :; do
    sleep "$interval"
    api POST /v1/device/token "{\"deviceCode\":\"$device_code\"}"
    if [[ "$STATUS" == 200 ]]; then
      TOKEN="$(json_get accessToken <<<"$RESP")"
      mkdir -p "$(dirname "$TOKEN_FILE")"
      (umask 077 && printf '%s' "$TOKEN" > "$TOKEN_FILE")
      echo "Signed in. Token saved to $TOKEN_FILE"
      return
    fi
    case "$(json_get code <<<"$RESP")" in
      authorization_pending) ;;
      slow_down) interval=$((interval + 5)) ;;
      *) fail "sign-in did not complete" ;;
    esac
  done
}

if [[ -s "$TOKEN_FILE" ]]; then
  TOKEN="$(cat "$TOKEN_FILE")"
else
  sign_in
fi

# --- 2. create the game (once) -----------------------------------------------

if [[ -s "$GAME_FILE" ]]; then
  GAME_ID="$(cat "$GAME_FILE")"
else
  api POST /v1/games "{\"name\":\"$GAME_NAME\"}"
  [[ "$STATUS" == 401 ]] && { rm -f "$TOKEN_FILE"; fail "token rejected; run again to sign in"; }
  [[ "$STATUS" =~ ^2 ]] || fail "could not create game"
  GAME_ID="$(json_get id <<<"$RESP")"
  [[ -n "$GAME_ID" ]] || fail "no game id in response"
  printf '%s' "$GAME_ID" > "$GAME_FILE"
  echo "Created game $GAME_ID"
fi

# --- 3. package the build ----------------------------------------------------

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/build"
for f in "${BUILD_FILES[@]}"; do cp -R "$ROOT/$f" "$WORK/build/"; done
ARCHIVE="$WORK/build.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$ARCHIVE" -C "$WORK/build" .
SIZE="$(wc -c < "$ARCHIVE" | tr -d ' ')"
echo "Packaged ${BUILD_FILES[*]} ($SIZE bytes)"

# --- 4. start build, upload, finalize ----------------------------------------

# Tag the build with its commit, but only when the working tree matches that commit.
SOURCE=""
if git -C "$ROOT" rev-parse --verify -q HEAD >/dev/null; then
  if [[ -z "$(git -C "$ROOT" status --porcelain)" ]]; then
    COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
    BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
    SOURCE=",\"source\":{\"commit\":\"$COMMIT\",\"branch\":\"$BRANCH\"}"
  else
    echo "note: uncommitted changes, so this build isn't tagged with a commit"
  fi
fi

api POST "/v1/games/$GAME_ID/builds" "{\"mode\":\"archive\",\"sizeBytes\":$SIZE$SOURCE}" \
  -H "Idempotency-Key: $(uuidgen)"
[[ "$STATUS" == 401 ]] && { rm -f "$TOKEN_FILE"; fail "token rejected; run again to sign in"; }
[[ "$STATUS" =~ ^2 ]] || fail "could not start build"
NUMBER="$(json_get number <<<"$RESP")"
UPLOAD_URL="$(json_get uploadUrl <<<"$RESP")"
[[ -n "$NUMBER" && -n "$UPLOAD_URL" ]] || fail "unexpected build response"

# Pre-signed URL: no Authorization header.
UP_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT -T "$ARCHIVE" "$UPLOAD_URL")"
[[ "$UP_STATUS" =~ ^2 ]] || fail "upload failed with HTTP $UP_STATUS"
echo "Uploaded build $NUMBER"

api POST "/v1/games/$GAME_ID/builds/$NUMBER/finalize"
[[ "$STATUS" =~ ^2 ]] || fail "finalize failed"

WARNINGS="$(json_get warnings <<<"$RESP")"
[[ -n "$WARNINGS" && "$WARNINGS" != "[]" ]] && echo "warnings: $WARNINGS"
echo "Play (latest): $(json_get playUrl <<<"$RESP")"
echo "This build:    $(json_get buildUrl <<<"$RESP")"

# --- 5. itch.io copy -----------------------------------------------------------
# The same files, with betacade.js told which build they are so play data from
# itch.io lands on this build. Upload the zip to itch.io as an HTML game.

mkdir -p "$ROOT/dist"
ITCH_ZIP="$ROOT/dist/the-last-leaf-itch-build$NUMBER.zip"
# Tag it with the itch.io tracked link (in .betacade-itch-via), so its play counts there.
VIA="$(cat "$ROOT/.betacade-itch-via")"
sed -i '' "s/data-build=\"[0-9]*\"/data-build=\"$NUMBER\" data-via=\"$VIA\"/" "$WORK/build/index.html"
rm -f "$ITCH_ZIP"
(cd "$WORK/build" && zip -qr "$ITCH_ZIP" .)
echo "itch.io zip:   $ITCH_ZIP"
