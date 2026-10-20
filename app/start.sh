#!/usr/bin/env bash
# 一键启动（Linux / macOS）：后台运行服务并打印访问地址
# 用法：bash start.sh            # 默认读取 config.local.json 或 .env 里的端口
#       PORT=9000 bash start.sh  # 临时换端口
set -e
cd "$(dirname "$0")"

PORT="${PORT:-8899}"
export PORT

# 1) 检查 Node 版本（需要 18+，用到内置 fetch）
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node：请先安装 Node.js 18 或更高版本（https://nodejs.org/zh-cn/download）" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "当前 Node 版本为 $(node -v)，需要 18 或更高。请升级后再试。" >&2
  exit 1
fi

# 2) 已在运行就不重复启动
if [ -f .run.pid ]; then
  OLD_PID="$(cat .run.pid 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "服务已在运行（pid $OLD_PID），如需重启先执行 bash stop.sh"
    exit 0
  fi
  rm -f .run.pid
fi

mkdir -p data

# 3) 后台启动，日志写入 data/server.log
nohup node server.js >> data/server.log 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > .run.pid

sleep 2
if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "已启动（pid $NEW_PID，端口 $PORT）"
  echo "  日志：$(pwd)/data/server.log"
  echo "  本机：http://127.0.0.1:$PORT"
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [ -n "$IP" ]; then echo "  内网：http://$IP:$PORT"; fi
  echo "  公网：http://<服务器公网IP>:$PORT（需在云厂商安全组放行 TCP $PORT）"
  echo "  停止：bash stop.sh"
else
  echo "启动失败，最后 20 行日志：" >&2
  tail -n 20 data/server.log >&2
  exit 1
fi
