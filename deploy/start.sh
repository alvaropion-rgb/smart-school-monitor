#!/bin/bash
# Start Smart School Monitor with PM2
# Run from /opt/smart-school-monitor/

set -e

APP_DIR="/opt/smart-school-monitor"
cd "$APP_DIR"

# Ensure data and uploads directories exist
mkdir -p data uploads/blueprints

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install --production
fi

# Start or restart with PM2
if pm2 describe smart-school-monitor > /dev/null 2>&1; then
  echo "Restarting Smart School Monitor..."
  pm2 restart smart-school-monitor
else
  echo "Starting Smart School Monitor..."
  pm2 start server.js --name smart-school-monitor
fi

# Save PM2 process list so it auto-starts on reboot
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER 2>/dev/null || true

echo ""
echo "Smart School Monitor is running!"
echo "Check status: pm2 status"
echo "View logs: pm2 logs smart-school-monitor"
