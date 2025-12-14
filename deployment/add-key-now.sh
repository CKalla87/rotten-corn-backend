#!/bin/bash

# Quick script to add the public key to the instance
# Uses EC2 Instance Connect for temporary access, then adds key permanently

BACKEND_INSTANCE_ID="i-07b8b7267334ba92d"
BACKEND_AZ="us-east-1b"
BACKEND_PRIVATE_IP="10.0.4.55"
BASTION_PUBLIC_IP="98.92.178.139"
REGION="us-east-1"
PUB_KEY_FILE="chatappKeyPair.pub"
PRIV_KEY_FILE="chatappKeyPair.pem"

if [ ! -f "$PUB_KEY_FILE" ]; then
  echo "✗ Public key file not found: $PUB_KEY_FILE"
  exit 1
fi

echo "=========================================="
echo "Adding SSH Key to Instance"
echo "=========================================="
echo ""

# Step 1: Add temporary key via EC2 Instance Connect
echo "Step 1: Adding temporary key via EC2 Instance Connect..."
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
echo ""

# Step 2: Connect via bastion and add key permanently
echo "Step 2: Connecting to add key permanently..."
echo ""

PUBLIC_KEY=$(cat "$PUB_KEY_FILE")

# Try to connect and add the key
ssh -i "$PRIV_KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=10 \
    -J ec2-user@"$BASTION_PUBLIC_IP" \
    ec2-user@"$BACKEND_PRIVATE_IP" \
    "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$PUBLIC_KEY' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 'Key added successfully!'" 2>&1

if [ $? -eq 0 ]; then
  echo ""
  echo "✓ Key added successfully!"
  echo ""
  echo "You can now SSH into the instance:"
  echo "  ssh -i $PRIV_KEY_FILE -J ec2-user@$BASTION_PUBLIC_IP ec2-user@$BACKEND_PRIVATE_IP"
else
  echo ""
  echo "⚠ Direct connection failed. Manual steps:"
  echo ""
  echo "1. Connect to bastion:"
  echo "   ssh -i $PRIV_KEY_FILE ec2-user@$BASTION_PUBLIC_IP"
  echo ""
  echo "2. From bastion, connect to backend:"
  echo "   ssh ec2-user@$BACKEND_PRIVATE_IP"
  echo ""
  echo "3. On the backend instance, run:"
  echo "   mkdir -p ~/.ssh"
  echo "   chmod 700 ~/.ssh"
  echo "   echo '$PUBLIC_KEY' >> ~/.ssh/authorized_keys"
  echo "   chmod 600 ~/.ssh/authorized_keys"
  echo ""
fi

