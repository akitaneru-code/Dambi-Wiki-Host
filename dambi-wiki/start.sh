#!/bin/bash

MONGO_DATA="/home/runner/workspace/mongodb-data"
MONGO_LOG="/tmp/mongod.log"
MONGO_PID="/tmp/mongod.pid"

mkdir -p "$MONGO_DATA"

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

echo "Starting 담비위키..."
cd /home/runner/workspace/dambi-wiki

# Unset cloud MongoDB secrets so local settings take effect
unset MONGODB_URL
unset MONGODB_HOST
unset MONGODB_PORT
unset MONGODB_USER
unset MONGODB_PASSWORD

exec node --no-node-snapshot main.js
