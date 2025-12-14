#!/bin/bash

# Add the new public key to existing EC2 instances
# This allows you to use your new private key to SSH into instances

BACKEND_INSTANCE_ID="i-07b8b7267334ba92d"
BACKEND_AZ="us-east-1b"
BASTION_INSTANCE_ID="i-09052b67a653152ab"
BASTION_AZ="us-east-1a"
REGION="us-east-1"
PUB_KEY_FILE="chatappKeyPair.pub"

if [ ! -f "$PUB_KEY_FILE" ]; then
  echo "✗ Public key file not found: $PUB_KEY_FILE"
  exit 1
fi

PUBLIC_KEY=$(cat "$PUB_KEY_FILE")

echo "=========================================="
echo "Adding Public Key to EC2 Instances"
echo "=========================================="
echo ""

# Method 1: Using SSM to add key to backend instance
echo "Method 1: Adding key via SSM Session Manager"
echo ""

# Add key to backend instance
echo "Adding key to backend instance ($BACKEND_INSTANCE_ID)..."
aws ssm send-command \
  --instance-ids "$BACKEND_INSTANCE_ID" \
  --region "$REGION" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    'mkdir -p ~/.ssh',
    'chmod 700 ~/.ssh',
    'echo \"$PUBLIC_KEY\" >> ~/.ssh/authorized_keys',
    'chmod 600 ~/.ssh/authorized_keys',
    'echo \"Key added successfully\"',
    'cat ~/.ssh/authorized_keys | tail -1'
  ]" \
  --output json > /tmp/ssm-command-backend.json 2>&1

if [ $? -eq 0 ]; then
  COMMAND_ID=$(cat /tmp/ssm-command-backend.json | grep -o '"CommandId":"[^"]*' | cut -d'"' -f4)
  if [ -n "$COMMAND_ID" ]; then
    echo "✓ Command sent. Command ID: $COMMAND_ID"
    echo "Waiting for command to complete..."
    sleep 5

    # Get command output
    aws ssm get-command-invocation \
      --command-id "$COMMAND_ID" \
      --instance-id "$BACKEND_INSTANCE_ID" \
      --region "$REGION" \
      --query '[Status,StandardOutputContent]' \
      --output text

    echo ""
  else
    echo "⚠ Could not get command ID. Check if SSM is available."
    echo "Trying alternative method..."
  fi
else
  echo "⚠ SSM command failed. Trying alternative method..."
fi

# Method 2: Using EC2 Instance Connect (temporary, then add permanently)
echo ""
echo "Method 2: Using EC2 Instance Connect + SSH"
echo ""

# First, use EC2 Instance Connect to get temporary access
echo "Step 1: Getting temporary access via EC2 Instance Connect..."
aws ec2-instance-connect send-ssh-public-key \
  --instance-id "$BACKEND_INSTANCE_ID" \
  --availability-zone "$BACKEND_AZ" \
  --instance-os-user ec2-user \
  --ssh-public-key "file://$PUB_KEY_FILE" \
  --region "$REGION" > /dev/null 2>&1

if [ $? -eq 0 ]; then
  echo "✓ Temporary key added (valid for 60 seconds)"
  echo ""
  echo "Step 2: Now connect via bastion and add key permanently..."
  echo ""
  echo "You can now run:"
  echo "  ssh -i chatappKeyPair.pem -J ec2-user@98.92.178.139 ec2-user@10.0.4.55"
  echo ""
  echo "Once connected, run these commands on the instance:"
  echo "  mkdir -p ~/.ssh"
  echo "  chmod 700 ~/.ssh"
  echo "  echo '$PUBLIC_KEY' >> ~/.ssh/authorized_keys"
  echo "  chmod 600 ~/.ssh/authorized_keys"
  echo ""
else
  echo "✗ Failed to add temporary key"
  echo ""
  echo "Alternative: Use SSM Session Manager to add the key"
  echo "  aws ssm start-session --target $BACKEND_INSTANCE_ID --region $REGION"
  echo ""
  echo "Then run on the instance:"
  echo "  mkdir -p ~/.ssh"
  echo "  chmod 700 ~/.ssh"
  echo "  echo '$PUBLIC_KEY' >> ~/.ssh/authorized_keys"
  echo "  chmod 600 ~/.ssh/authorized_keys"
fi

echo ""
echo "=========================================="
echo "Next Steps"
echo "=========================================="
echo ""
echo "1. The key has been added (or you need to add it manually)"
echo "2. Test SSH connection:"
echo "   cd .."
echo "   ssh -i deployment/chatappKeyPair.pem -J ec2-user@98.92.178.139 ec2-user@10.0.4.55"
echo ""
echo "Or use the helper script:"
echo "   ./deployment/ssh-to-instance.sh"
echo ""

