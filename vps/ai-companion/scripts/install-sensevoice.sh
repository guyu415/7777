#!/usr/bin/env bash
set -euo pipefail

MODEL_DIR="${AI_COMPANION_SENSEVOICE_DIR:-/opt/ai-companion/models/sensevoice}"
RUNTIME_URL="https://github.com/QwenAudio/SenseVoice/releases/download/runtime-llamacpp-v0.1.9/funasr-llamacpp-linux-x64-avx2.tar.gz"
MODEL_URL="https://huggingface.co/FunAudioLLM/SenseVoiceSmall-GGUF/resolve/main/sensevoice-small-q8.gguf"
MODEL_BYTES=254208320

mkdir -p "$MODEL_DIR"
work_dir="$(mktemp -d)"
cleanup() { find "$work_dir" -depth -delete 2>/dev/null || true; }
trap cleanup EXIT

if [[ ! -x "$MODEL_DIR/llama-funasr-sensevoice" ]]; then
  curl -fL --retry 3 --max-time 180 "$RUNTIME_URL" -o "$work_dir/runtime.tar.gz"
  tar -xzf "$work_dir/runtime.tar.gz" -C "$work_dir"
  install -m 0755 "$work_dir/llama-funasr-sensevoice" "$MODEL_DIR/llama-funasr-sensevoice"
fi

if [[ ! -f "$MODEL_DIR/sensevoice-small-q8.gguf" ]] \
  || [[ "$(stat -c %s "$MODEL_DIR/sensevoice-small-q8.gguf")" != "$MODEL_BYTES" ]]; then
  curl -fL --retry 3 --max-time 300 "$MODEL_URL" -o "$work_dir/sensevoice-small-q8.gguf"
  [[ "$(stat -c %s "$work_dir/sensevoice-small-q8.gguf")" == "$MODEL_BYTES" ]]
  install -m 0644 "$work_dir/sensevoice-small-q8.gguf" "$MODEL_DIR/sensevoice-small-q8.gguf"
fi

printf 'SenseVoice installed: %s\n' "$MODEL_DIR"
