#!/usr/bin/env bash
set -e

ROOT="/Users/pelazas/Desktop/drawtocloud"

# Require tmux
if ! command -v tmux &>/dev/null; then
  echo "tmux is required. Install with: brew install tmux"
  exit 1
fi

SESSION="drawtocloud"

# Kill existing session if any
tmux kill-session -t "$SESSION" 2>/dev/null || true

# Create new session with 4 panes
# Pane 0: backend (uvicorn)
tmux new-session -d -s "$SESSION" -x 220 -y 50

# Split vertically → left/right
tmux split-window -h -t "$SESSION"

# Split each half horizontally → 4 panes total
tmux split-window -v -t "$SESSION:0.0"
tmux split-window -v -t "$SESSION:0.2"

# Pane layout:
#  0 (top-left)  | 2 (top-right)
#  1 (bot-left)  | 3 (bot-right)

# Pane 0: Backend
tmux send-keys -t "$SESSION:0.0" \
  "cd '$ROOT/backend' && echo '=== Backend ===' && uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload" Enter

# Pane 1: Backend logs placeholder / shell
tmux send-keys -t "$SESSION:0.1" \
  "cd '$ROOT/backend' && echo '=== Backend logs (press Ctrl+C to stop) ==='" Enter

# Pane 2: Frontend
tmux send-keys -t "$SESSION:0.2" \
  "cd '$ROOT/frontend' && echo '=== Frontend ===' && pnpm dev" Enter

# Pane 3: Info / shell
tmux send-keys -t "$SESSION:0.3" \
  "echo '=== DrawToCloud Dev ===' && echo 'Frontend: http://localhost:3000' && echo 'Backend:  http://localhost:8000' && echo 'Health:   http://localhost:8000/health' && echo '' && cd '$ROOT'" Enter

# Focus top-left (backend)
tmux select-pane -t "$SESSION:0.0"

echo "Started tmux session '$SESSION'."
echo "Attach with: tmux attach -t $SESSION"
tmux attach -t "$SESSION"
