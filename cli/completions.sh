#!/bin/bash
# airelay shell completion for bash

_airelay_completions() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  local prev="${COMP_WORDS[COMP_CWORD-1]}"

  local commands="init login local local:start local:status agent:install agent:doctor agent:uninstall help"
  local agents="codex claude-code"
  local options="--help --version --config --port --host --dry-run"

  if [[ ${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "${commands}" -- "${cur}"))
  elif [[ ${prev} == "--config" || ${prev} == "-c" ]]; then
    COMPREPLY=($(compgen -f -- "${cur}"))
  elif [[ ${prev} == agent:* ]]; then
    COMPREPLY=($(compgen -W "${agents}" -- "${cur}"))
  else
    COMPREPLY=($(compgen -W "${options}" -- "${cur}"))
  fi
}

complete -F _airelay_completions airelay
