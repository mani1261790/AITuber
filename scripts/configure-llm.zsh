#!/bin/zsh
set -eu

repo_root=${0:A:h:h}
env_file="$repo_root/.env"
example_file="$repo_root/.env.example"
[[ -f "$env_file" ]] || cp "$example_file" "$env_file"
chmod 600 "$env_file"

printf 'LLM API key（Ollamaのloopback接続では空欄可、入力内容は表示されません）: '
IFS= read -r -s api_key
printf '\nモデル名: '
IFS= read -r model
printf 'Base URL（通常は空欄、Ollama例 http://localhost:11434/v1）: '
IFS= read -r base_url

if [[ -z "$model" ]]; then
  print -u2 'モデル名は必須です。設定は変更していません。'
  exit 1
fi

temporary_file=$(mktemp "$repo_root/.env.llm.XXXXXX")
trap 'rm -f "$temporary_file"' EXIT
typeset -A replacements
replacements[AITUBER_LLM_API_KEY]="$api_key"
replacements[AITUBER_LLM_MODEL]="$model"
replacements[AITUBER_LLM_BASE_URL]="$base_url"
typeset -A found

while IFS= read -r line || [[ -n "$line" ]]; do
  key=${line%%=*}
  if [[ -n "${replacements[$key]+present}" ]]; then
    printf '%s=%s\n' "$key" "${replacements[$key]}" >> "$temporary_file"
    found[$key]=1
  else
    printf '%s\n' "$line" >> "$temporary_file"
  fi
done < "$env_file"

for key in AITUBER_LLM_API_KEY AITUBER_LLM_MODEL AITUBER_LLM_BASE_URL; do
  [[ -n "${found[$key]+present}" ]] || printf '%s=%s\n' "$key" "${replacements[$key]}" >> "$temporary_file"
done

chmod 600 "$temporary_file"
mv "$temporary_file" "$env_file"
trap - EXIT
unset api_key
printf 'LLM接続を .env に保存しました。次に pnpm verify:llm を実行してください。\n'
