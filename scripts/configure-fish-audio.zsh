#!/bin/zsh
set -eu

repo_root=${0:A:h:h}
env_file="$repo_root/.env"
example_file="$repo_root/.env.example"

if [[ ! -f "$env_file" ]]; then
  cp "$example_file" "$env_file"
fi

chmod 600 "$env_file"

printf 'Fish Audio API key（入力内容は表示されません）: '
IFS= read -r -s api_key
printf '\n'

if [[ -z "$api_key" ]]; then
  print -u2 'APIキーが空です。設定は変更していません。'
  exit 1
fi

temporary_file=$(mktemp "$repo_root/.env.fish.XXXXXX")
trap 'rm -f "$temporary_file"' EXIT
found=0

while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == AITUBER_FISH_AUDIO_API_KEY=* ]]; then
    printf 'AITUBER_FISH_AUDIO_API_KEY=%s\n' "$api_key" >> "$temporary_file"
    found=1
  else
    printf '%s\n' "$line" >> "$temporary_file"
  fi
done < "$env_file"

if [[ "$found" -eq 0 ]]; then
  printf '\nAITUBER_FISH_AUDIO_API_KEY=%s\n' "$api_key" >> "$temporary_file"
fi

chmod 600 "$temporary_file"
mv "$temporary_file" "$env_file"
trap - EXIT
unset api_key

printf 'Fish Audio APIキーを .env に保存しました。次に pnpm verify:tts を実行してください。\n'
