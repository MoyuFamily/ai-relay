#compdef airelay

_airelay() {
  local line state

  _arguments -C \
    "1: :->cmds" \
    "*::arg:->args"

  case "$state" in
    cmds)
      _values "airelay command" \
        "init[Interactive local relay setup wizard]" \
        "login[Bind device to cloud or self-hosted admin]" \
        "local[Manage local relay server]" \
        "local:start[Start local relay server]" \
        "local:status[Show status and configuration]" \
        "agent:install[Configure local AI agent]" \
        "agent:doctor[Check agent configuration]" \
        "agent:uninstall[Remove agent configuration]" \
        "help[Display help]"
      ;;
    args)
      case $line[1] in
        local:start)
          _arguments \
            "--config[Config file path or URL]:file:_files" \
            "--port[Port number]:port:" \
            "--host[Host address]:host:"
          ;;
        agent:install|agent:doctor|agent:uninstall)
          _arguments \
            "1:agent:(codex claude-code)" \
            "--dry-run[Show what would be changed]"
          ;;
      esac
      ;;
  esac
}

if [[ "${funcstack[1]:-}" == "_airelay" ]]; then
  _airelay "$@"
elif (( $+functions[compdef] )); then
  compdef _airelay airelay
fi
