#!/bin/bash
# Deploy Smart School Monitor to Oracle Cloud VM
# Run this FROM YOUR MAC
#
# Usage: bash deploy/deploy-to-cloud.sh <server-ip> [ssh-key-path]
# Example: bash deploy/deploy-to-cloud.sh 129.153.xx.xx ~/.ssh/oracle-key

set -e

SERVER_IP="$1"
SSH_KEY="${2:-~/.ssh/id_rsa}"

if [ -z "$SERVER_IP" ]; then
  echo "Usage: bash deploy/deploy-to-cloud.sh <server-ip> [ssh-key-path]"
  echo ""
  echo "  server-ip    : Your Oracle Cloud VM public IP address"
  echo "  ssh-key-path : Path to SSH private key (default: ~/.ssh/id_rsa)"
  exit 1
fi

SSH_USER="ubuntu"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no $SSH_USER@$SERVER_IP"
SCP_CMD="scp -i $SSH_KEY -o StrictHostKeyChecking=no"
REMOTE_DIR="/opt/smart-school-monitor"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "========================================="
echo "  Deploying Smart School Monitor"
echo "  Server: $SERVER_IP"
echo "  Source: $LOCAL_DIR"
echo "========================================="
echo ""

# 1. Create remote directory
echo "[1/5] Preparing remote directory..."
$SSH_CMD "sudo mkdir -p $REMOTE_DIR && sudo chown \$USER:\$USER $REMOTE_DIR"

# 2. Sync files (exclude node_modules, data, .env)
echo "[2/5] Uploading files..."
rsync -avz --progress \
  -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
  --exclude 'node_modules' \
  --exclude 'data/*.db' \
  --exclude '.env' \
  --exclude 'uploads/blueprints/*' \
  "$LOCAL_DIR/" "$SSH_USER@$SERVER_IP:$REMOTE_DIR/"

# 3. Install dependencies on remote
echo "[3/5] Installing dependencies on server..."
$SSH_CMD "cd $REMOTE_DIR && npm install --production"

# 4. Set up .env if it doesn't exist
echo "[4/5] Checking .env configuration..."
$SSH_CMD "if [ ! -f $REMOTE_DIR/.env ]; then cp $REMOTE_DIR/.env.example $REMOTE_DIR/.env; echo 'Created .env from template — EDIT IT with your settings!'; else echo '.env already exists, skipping'; fi"

# 5. Configure Nginx
echo "[5/5] Configuring Nginx..."
$SSH_CMD "sudo cp $REMOTE_DIR/deploy/nginx.conf /etc/nginx/sites-available/smart-school-monitor && sudo ln -sf /etc/nginx/sites-available/smart-school-monitor /etc/nginx/sites-enabled/ && sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx"

echo ""
echo "========================================="
echo "  Upload complete!"
echo ""
echo "  SSH into the server to finish setup:"
echo "  ssh -i $SSH_KEY $SSH_USER@$SERVER_IP"
echo ""
echo "  Then run:"
echo "  1. nano $REMOTE_DIR/.env"
echo "     Set WEB_APP_URL=http://$SERVER_IP"
echo "  2. cd $REMOTE_DIR && bash deploy/start.sh"
echo "  3. Open http://$SERVER_IP in your browser"
echo "========================================="
