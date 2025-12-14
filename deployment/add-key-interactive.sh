#!/bin/bash

# Interactive script to add SSH key to backend instance
# This uses EC2 Instance Connect and manual steps

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

PUBLIC_KEY=$(cat "$PUB_KEY_FILE")

echo "=========================================="
echo "Adding SSH Key to Backend Instance"
echo "=========================================="
echo ""

# Step 1: Add temporary key
echo "Step 1: Adding temporary key via EC2 Instance Connect..."
aws ec2-instance-connect send-ssh-public-key \
  --instance-id "$BACKEND_INSTANCE_ID" \
  --availability-zone "$BACKEND_AZ" \
  --instance-os-user ec2-user \
  --ssh-public-key "file://$PUB_KEY_FILE" \
  --region "$REGION"

if [ $? -ne 0 ]; then
  echo "✗ Failed to add temporary key"
  exit 1
fi

echo ""
echo "✓ Temporary key added (valid for 60 seconds)"
echo ""

# Step 2: Copy public key to bastion
echo "Step 2: Copying public key to bastion..."
ssh -i "$PRIV_KEY_FILE" -o StrictHostKeyChecking=no ec2-user@"$BASTION_PUBLIC_IP" \
  "echo '$PUBLIC_KEY' > /tmp/new_key.pub && echo 'Key copied to bastion'" 2>&1

if [ $? -ne 0 ]; then
  echo "✗ Failed to copy key to bastion"
  exit 1
fi

echo "✓ Key copied to bastion"
echo ""

# Step 3: Connect to bastion and add key to backend
echo "Step 3: Now connecting to bastion..."
echo "Once connected, run these commands on the backend instance:"
echo ""
echo "  ssh -i /tmp/new_key.pem ec2-user@$BACKEND_PRIVATE_IP"
echo "  # Or if that doesn't work, try:"
echo "  ssh ec2-user@$BACKEND_PRIVATE_IP"
echo ""
echo "Then on the backend instance, run:"
echo "  mkdir -p ~/.ssh"
echo "  chmod 700 ~/.ssh"
echo "  cat /tmp/new_key.pub >> ~/.ssh/authorized_keys"
echo "  chmod 600 ~/.ssh/authorized_keys"
echo "  exit"
echo ""

# Actually, let's try to do it automatically
echo "Attempting automatic connection..."

# First, let's copy the private key to bastion temporarily (for the EC2 Instance Connect session)
# Actually, we can't do that securely. Let me try a different approach.

# Use the bastion to SSH to backend with the temporary key
# We need to forward the key through the bastion
ssh -i "$PRIV_KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o ForwardAgent=yes \
    ec2-user@"$BASTION_PUBLIC_IP" \
    "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 ec2-user@$BACKEND_PRIVATE_IP 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo \"$PUBLIC_KEY\" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo Key added successfully'" 2>&1

if [ $? -eq 0 ]; then
  echo ""
  echo "✓ Key added successfully!"
  echo ""
  echo "You can now SSH into the instance:"
  echo "  ssh -i $PRIV_KEY_FILE -J ec2-user@$BASTION_PUBLIC_IP ec2-user@$BACKEND_PRIVATE_IP"
else
  echo ""
  echo "⚠ Automatic connection failed."
  echo ""
  echo "Manual steps:"
  echo "1. Connect to bastion:"
  echo "   ssh -i $PRIV_KEY_FILE ec2-user@$BASTION_PUBLIC_IP"
  echo ""
  echo "2. From bastion, the public key is at: /tmp/new_key.pub"
  echo "   Copy it and add to backend:"
  echo "   ssh ec2-user@$BACKEND_PRIVATE_IP"
  echo "   # (This will use the temporary EC2 Instance Connect key)"
  echo "   mkdir -p ~/.ssh && chmod 700 ~/.ssh"
  echo "   echo '$(cat $PUB_KEY_FILE)' >> ~/.ssh/authorized_keys"
  echo "   chmod 600 ~/.ssh/authorized_keys"
fi

