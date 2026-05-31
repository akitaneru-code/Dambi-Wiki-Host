#!/bin/bash

MONGO_DATA="/home/runner/workspace/mongodb-data"
MONGO_LOG="/tmp/mongod.log"
MONGO_PID="/tmp/mongod.pid"
MEILI_DATA="/home/runner/workspace/meili-data"
MEILI_LOG="/tmp/meilisearch.log"
MEILI_PID="/tmp/meilisearch.pid"
MEILI_BIN="/home/runner/workspace/dambi-wiki/bin/meilisearch"

mkdir -p "$MONGO_DATA" "$MEILI_DATA"

# Kill existing mongod if running
if [ -f "$MONGO_PID" ] && kill -0 $(cat "$MONGO_PID") 2>/dev/null; then
  echo "MongoDB already running (PID $(cat $MONGO_PID))"
else
  echo "Starting MongoDB..."
  mongod --dbpath "$MONGO_DATA" \
    --port 27017 \
    --bind_ip 127.0.0.1 \
    --fork \
    --logpath "$MONGO_LOG" \
    --pidfilepath "$MONGO_PID" \
    --wiredTigerCacheSizeGB 0.25

  echo "Waiting for MongoDB to be ready..."
  node -e "
const net = require('net');
const check = (tries) => {
  if (tries <= 0) { console.log('MongoDB ready (timeout passed)'); process.exit(0); }
  const s = new net.Socket();
  s.setTimeout(500);
  s.on('connect', () => { s.destroy(); setTimeout(() => { console.log('MongoDB ready.'); process.exit(0); }, 2000); });
  s.on('error', () => { s.destroy(); setTimeout(() => check(tries - 1), 500); });
  s.on('timeout', () => { s.destroy(); setTimeout(() => check(tries - 1), 500); });
  s.connect(27017, '127.0.0.1');
};
check(30);
"
fi

# Start MeiliSearch using MEILISEARCH_KEY secret as master key
if [ -f "$MEILI_BIN" ] && [ -n "$MEILISEARCH_KEY" ]; then
  if [ -f "$MEILI_PID" ] && kill -0 $(cat "$MEILI_PID") 2>/dev/null; then
    echo "MeiliSearch already running (PID $(cat $MEILI_PID))"
  else
    echo "Starting MeiliSearch..."
    nohup "$MEILI_BIN" \
      --db-path "$MEILI_DATA" \
      --http-addr "127.0.0.1:7700" \
      --master-key "$MEILISEARCH_KEY" \
      --no-analytics \
      > "$MEILI_LOG" 2>&1 &
    echo $! > "$MEILI_PID"

    echo "Waiting for MeiliSearch to be ready..."
    node -e "
const net = require('net');
const check = (tries) => {
  if (tries <= 0) { console.log('MeiliSearch ready (timeout)'); process.exit(0); }
  const s = new net.Socket();
  s.setTimeout(500);
  s.on('connect', () => { s.destroy(); setTimeout(() => { console.log('MeiliSearch ready.'); process.exit(0); }, 500); });
  s.on('error', () => { s.destroy(); setTimeout(() => check(tries - 1), 500); });
  s.on('timeout', () => { s.destroy(); setTimeout(() => check(tries - 1), 500); });
  s.connect(7700, '127.0.0.1');
};
check(20);
"
  fi
  # Set host/index for the wiki (key is already in env from Replit secret)
  export MEILISEARCH_HOST="http://127.0.0.1:7700"
  export MEILISEARCH_INDEX="documents"
else
  echo "MeiliSearch binary or MEILISEARCH_KEY not set, skipping search engine..."
fi

echo "Starting 담비위키..."
cd /home/runner/workspace/dambi-wiki

# Unset cloud MongoDB secrets so local settings take effect
unset MONGODB_URL
unset MONGODB_HOST
unset MONGODB_PORT
unset MONGODB_USER
unset MONGODB_PASSWORD

exec node --no-node-snapshot main.js
