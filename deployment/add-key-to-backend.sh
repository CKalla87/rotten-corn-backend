#!/bin/bash

# One-command script to add key to backend instance
# Uses EC2 Instance Connect for temporary access

BACKEND_INSTANCE_ID="i-07b8b7267334ba92d"
BACKEND_AZ="us-east-1b"
BACKEND_PRIVATE_IP="10.0.4.55"
BASTION_PUBLIC_IP="98.92.178.139"
REGION="us-east-1"
PUB_KEY_FILE="chatappKeyPair.pub"
PRIV_KEY_FILE="chatappKeyPair.pem"

if [ ! -f "$PUB_KEY_FILE" ] || [ ! -f "$PRIV_KEY_FILE" ]; then
  echo "✗ Key files not found"
  exit 1
fi

echo "Adding temporary key to backend instance..."
aws ec2-instance-connect send-ssh-public-key \
  --instance-id "$BACKEND_INSTANCE_ID" \
  --availability-zone "$BACKEND_AZ" \
  --instance-os-user ec2-user \
  --ssh-public-key "file://$PUB_KEY_FILE" \
  --region "$REGION" > /dev/null 2>&1

if [ $? -ne 0 ]; then
  echo "✗ Failed to add temporary key"
  exit 1
fi

echo "✓ Temporary key added (valid for 60 seconds)"
echo "Connecting to add key permanently..."

sleep 2

PUBLIC_KEY=$(cat "$PUB_KEY_FILE")

# Connect via bastion and add key
ssh -i "$PRIV_KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=10 \
    -J ec2-user@"$BASTION_PUBLIC_IP" \
    ec2-user@"$BACKEND_PRIVATE_IP" \
    << EOF
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo '$PUBLIC_KEY' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
echo "✓ Key added successfully!"
EOF

if [ $? -eq 0 ]; then
  echo ""
  echo "=========================================="
  echo "✓ Key added successfully!"
  echo "=========================================="
  echo ""
  echo "You can now SSH into the instance:"
  echo "  ssh -i $PRIV_KEY_FILE -J ec2-user@$BASTION_PUBLIC_IP ec2-user@$BACKEND_PRIVATE_IP"
  echo ""
  echo "Or use the helper script:"
  echo "  ./ssh-to-instance.sh"
else
  echo ""
  echo "⚠ Connection failed. The temporary key may have expired."
  echo "Run this script again - it will add a fresh temporary key."
fi

