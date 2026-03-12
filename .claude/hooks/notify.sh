#!/bin/bash
# DrawToCloud — Claude Code notification hook
# Plays a sound when Claude finishes work or needs your input
# Place at: drawtocloud/.claude/hooks/notify.sh

# --- Cross-platform sound ---
play_sound() {
  if command -v afplay &>/dev/null; then
    # macOS
    afplay /System/Library/Sounds/Glass.aiff &

  elif command -v paplay &>/dev/null; then
    # Linux (PulseAudio)
    paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null \
      || paplay /usr/share/sounds/ubuntu/stereo/message.ogg 2>/dev/null &

  elif command -v pw-play &>/dev/null; then
    # Linux (PipeWire)
    pw-play /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null &

  elif command -v powershell.exe &>/dev/null; then
    # WSL / Windows
    powershell.exe -c "[console]::beep(880,200)" &

  else
    # Fallback: terminal bell
    echo -e "\a"
  fi
}

# --- Cross-platform desktop notification (optional, non-blocking) ---
send_notification() {
  local title="$1"
  local message="$2"

  if command -v osascript &>/dev/null; then
    # macOS
    osascript -e "display notification \"$message\" with title \"$title\"" &

  elif command -v notify-send &>/dev/null; then
    # Linux
    notify-send "$title" "$message" --icon=utilities-terminal --expire-time=4000 &

  elif command -v powershell.exe &>/dev/null; then
    # WSL
    powershell.exe -c "
      Add-Type -AssemblyName System.Windows.Forms
      \$notify = New-Object System.Windows.Forms.NotifyIcon
      \$notify.Icon = [System.Drawing.SystemIcons]::Information
      \$notify.Visible = \$true
      \$notify.ShowBalloonTip(4000, '$title', '$message', [System.Windows.Forms.ToolTipIcon]::Info)
    " &
  fi
}

# --- Hook event type (passed by Claude Code as first argument) ---
EVENT="${1:-unknown}"

case "$EVENT" in
  "stop")
    # Claude finished its work
    play_sound
    send_notification "DrawToCloud ✓" "Claude finished — ready for review"
    ;;
  "notification")
    # Claude is asking you something / needs input
    play_sound
    play_sound  # double beep = needs attention
    send_notification "DrawToCloud 💬" "Claude needs your input"
    ;;
  *)
    # Any other hook event — single beep
    play_sound
    ;;
esac