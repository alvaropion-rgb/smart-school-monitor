#!/bin/bash
# Smart School Monitor — Oracle Cloud VM Setup Script
# Run this ON the Oracle Cloud VM after SSH-ing in
# Usage: bash setup-server.sh

set -e

echo "========================================="
echo "  Smart School Monitor — Server Setup"
echo "========================================="
echo ""

# 1. Update system
echo "[1/7] Updating system packages..."
sudo apt-get update -y && sudo apt-get upgrade -y

# 2. Install Node.js 20 LTS
echo "[2/7] Installing Node.js 20 LTS..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node.js version: $(node -v)"
echo "npm version: $(npm -v)"

# 3. Install PM2 for process management
echo "[3/7] Installing PM2..."
sudo npm install -g pm2

# 4. Install Nginx for reverse proxy
echo "[4/7] Installing Nginx..."
sudo apt-get install -y nginx

# 5. Create app directory
echo "[5/7] Setting up app directory..."
sudo mkdir -p /opt/smart-school-monitor
sudo chown $USER:$USER /opt/smart-school-monitor

echo ""
echo "========================================="
echo "  System setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Upload your webapp files to /opt/smart-school-monitor/"
echo "  2. Run: cd /opt/smart-school-monitor && npm install"
echo "  3. Copy .env.example to .env and edit it"
echo "  4. Run: bash deploy/start.sh"
echo "========================================="
