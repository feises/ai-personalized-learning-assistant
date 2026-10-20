#!/usr/bin/env bash
# 一键停止（Linux / macOS）：只结束本项目启动的进程
set -e
cd "$(dirname "$0")"

if [ ! -f .run.pid ]; then
  echo "没有找到 .run.pid，服务可能未通过 start.sh 启动"
  exit 0
fi

PID="$(cat .run.pid 2>/dev/null || true)"
if [ -z "$PID" ]; then
  echo ".run.pid 内容为空，已清理"
  rm -f .run.pid
  exit 0
fi

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$PID" 2>/dev/null; then break; fi
    sleep 0.3
  done
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID" 2>/dev/null || true
  fi
  echo "已停止（pid $PID）"
else
  echo "进程 $PID 已不存在，清理 pid 文件"
fi
rm -f .run.pid
