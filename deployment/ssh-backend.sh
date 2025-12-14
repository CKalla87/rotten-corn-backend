#!/bin/bash

# SSH to backend instance via bastion
# This script properly handles key authentication for the jump host

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="$SCRIPT_DIR/chatappKeyPair.pem"
PUB_KEY_FILE="$SCRIPT_DIR/chatappKeyPair.pub"
BASTION="ec2-user@98.92.178.139"
BACKEND="ec2-user@10.0.4.55"
BACKEND_INSTANCE_ID="i-07b8b7267334ba92d"
BACKEND_AZ="us-east-1b"
REGION="us-east-1"

# Check if we need to add the key to backend first
echo "Checking backend connection..."
ssh -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ProxyCommand="ssh -i $KEY_FILE -W %h:%p $BASTION" \
    -o ConnectTimeout=3 \
    "$BACKEND" \
    "echo 'Key already configured'" > /dev/null 2>&1

if [ $? -ne 0 ]; then
  echo "Adding temporary key to backend instance..."
  aws ec2-instance-connect send-ssh-public-key \
    --instance-id "$BACKEND_INSTANCE_ID" \
    --availability-zone "$BACKEND_AZ" \
    --instance-os-user ec2-user \
    --ssh-public-key "file://$PUB_KEY_FILE" \
    --region "$REGION" > /dev/null 2>&1

  if [ $? -eq 0 ]; then
    echo "✓ Temporary key added (valid for 60 seconds)"
    echo "Connecting and adding key permanently..."

    # Connect and add key permanently
    PUBLIC_KEY=$(cat "$PUB_KEY_FILE")
    ssh -i "$KEY_FILE" \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -o ProxyCommand="ssh -i $KEY_FILE -W %h:%p $BASTION" \
        "$BACKEND" \
        "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$PUBLIC_KEY' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo '✓ Key added permanently!'" 2>&1

    if [ $? -eq 0 ]; then
      echo "✓ Key configured successfully!"
      echo ""
    fi
  fi
fi

# Now connect normally
ssh -i "$KEY_FILE" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ProxyCommand="ssh -i $KEY_FILE -W %h:%p $BASTION" \
    "$BACKEND" \
    "$@"

