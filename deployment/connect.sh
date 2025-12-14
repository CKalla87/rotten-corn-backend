#!/bin/bash

# Simple connection script with full path
KEY_FILE="$(cd "$(dirname "$0")" && pwd)/chatappKeyPair.pem"
BASTION="ec2-user@98.92.178.139"
BACKEND="ec2-user@10.0.4.55"

echo "Connecting to backend via bastion..."
echo "Key file: $KEY_FILE"
echo ""

# First, let's add the temporary key to backend
echo "Adding temporary key to backend instance..."
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-07b8b7267334ba92d \
  --availability-zone us-east-1b \
  --instance-os-user ec2-user \
  --ssh-public-key "file://$(dirname "$KEY_FILE")/chatappKeyPair.pub" \
  --region us-east-1 > /dev/null 2>&1

if [ $? -eq 0 ]; then
  echo "✓ Temporary key added (valid for 60 seconds)"
  echo ""
  echo "Connecting..."
  ssh -i "$KEY_FILE" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -J "$BASTION" \
      "$BACKEND" \
      "$@"
else
  echo "⚠ Failed to add temporary key, trying anyway..."
  ssh -i "$KEY_FILE" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -J "$BASTION" \
      "$BACKEND" \
      "$@"
fi

