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

if [[ "$base_url" == http://localhost:* || "$base_url" == http://127.0.0.1:* || "$base_url" == http://\[::1\]:* ]]; then
  input_price=0
  output_price=0
  authoring_budget=
  runtime_budget=
else
  if [[ -z "$api_key" ]]; then
    print -u2 '外部LLMではAPIキーが必須です。設定は変更していません。'
    exit 1
  fi
  printf '入力100万token単価（USD、Providerの現在値）: '
  IFS= read -r input_price
  printf '出力100万token単価（USD、Providerの現在値）: '
  IFS= read -r output_price
  printf '教材作成の1日上限（USD、既定案 2）: '
  IFS= read -r authoring_budget
  printf '授業時の1日上限（USD、既定案 1）: '
  IFS= read -r runtime_budget
  authoring_budget=${authoring_budget:-2}
  runtime_budget=${runtime_budget:-1}
  if [[ -z "$input_price" || -z "$output_price" ]]; then
    print -u2 '外部LLMでは入力・出力単価が必須です。設定は変更していません。'
    exit 1
  fi
fi

temporary_file=$(mktemp "$repo_root/.env.llm.XXXXXX")
trap 'rm -f "$temporary_file"' EXIT
typeset -A replacements
replacements[AITUBER_LLM_API_KEY]="$api_key"
replacements[AITUBER_LLM_MODEL]="$model"
replacements[AITUBER_LLM_BASE_URL]="$base_url"
replacements[AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS]="$input_price"
replacements[AITUBER_LLM_OUTPUT_USD_PER_MILLION_TOKENS]="$output_price"
replacements[AITUBER_AUTHORING_DAILY_BUDGET_USD]="$authoring_budget"
replacements[AITUBER_RUNTIME_DAILY_BUDGET_USD]="$runtime_budget"
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

for key in AITUBER_LLM_API_KEY AITUBER_LLM_MODEL AITUBER_LLM_BASE_URL AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS AITUBER_LLM_OUTPUT_USD_PER_MILLION_TOKENS AITUBER_AUTHORING_DAILY_BUDGET_USD AITUBER_RUNTIME_DAILY_BUDGET_USD; do
  [[ -n "${found[$key]+present}" ]] || printf '%s=%s\n' "$key" "${replacements[$key]}" >> "$temporary_file"
done

chmod 600 "$temporary_file"
mv "$temporary_file" "$env_file"
trap - EXIT
unset api_key
printf 'LLM接続を .env に保存しました。次に pnpm verify:llm を実行してください。\n'
