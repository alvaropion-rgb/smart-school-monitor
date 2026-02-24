#!/bin/bash
# Update SNMP Gateway to push data to the cloud server
# Run this FROM YOUR MAC after deploying to Oracle Cloud
#
# Usage: bash deploy/update-gateway-url.sh <server-ip>
# Example: bash deploy/update-gateway-url.sh 129.153.xx.xx

set -e

SERVER_IP="$1"

if [ -z "$SERVER_IP" ]; then
  echo "Usage: bash deploy/update-gateway-url.sh <server-ip>"
  echo ""
  echo "  server-ip : Your Oracle Cloud VM public IP address"
  exit 1
fi

GATEWAY_CONFIG="/Users/varycat/Desktop/CodeMAPCopier/snmp-gateway/config.json"

if [ ! -f "$GATEWAY_CONFIG" ]; then
  echo "ERROR: Gateway config not found at $GATEWAY_CONFIG"
  exit 1
fi

# Update the gateway config to point to the cloud server
# Using port 80 since Nginx handles the proxy
python3 -c "
import json
with open('$GATEWAY_CONFIG', 'r') as f:
    config = json.load(f)
config['appsScriptUrl'] = 'http://$SERVER_IP/api/gateway'
with open('$GATEWAY_CONFIG', 'w') as f:
    json.dump(config, f, indent=2)
print('Updated appsScriptUrl to: http://$SERVER_IP/api/gateway')
"

echo ""
echo "Gateway config updated!"
echo "Restart the SNMP gateway to apply:"
echo "  cd /Users/varycat/Desktop/CodeMAPCopier/snmp-gateway"
echo "  npm start"
