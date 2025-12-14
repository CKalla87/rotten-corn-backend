#!/bin/bash

# SSH connection script for backend instance
# This script helps you connect to the backend instance through the bastion host

# Instance information (updated automatically)
BASTION_PUBLIC_IP="98.92.178.139"
BASTION_INSTANCE_ID="i-09052b67a653152ab"
BACKEND_PRIVATE_IP="10.0.4.55"
BACKEND_INSTANCE_ID="i-07b8b7267334ba92d"
BACKEND_AZ="us-east-1b"
REGION="us-east-1"
KEY_NAME="chatappKeyPair"

echo "=========================================="
echo "SSH Connection Helper"
echo "=========================================="
echo ""
echo "Bastion Host:"
echo "  Public IP: $BASTION_PUBLIC_IP"
echo "  Instance ID: $BASTION_INSTANCE_ID"
echo ""
echo "Backend Instance:"
echo "  Private IP: $BACKEND_PRIVATE_IP"
echo "  Instance ID: $BACKEND_INSTANCE_ID"
echo "  Availability Zone: $BACKEND_AZ"
echo ""
echo "=========================================="
echo ""

# Check if key file exists
KEY_FILE=""
if [ -f "chatappKeyPair.pem" ]; then
  KEY_FILE="chatappKeyPair.pem"
elif [ -f "../chatappKeyPair.pem" ]; then
  KEY_FILE="../chatappKeyPair.pem"
elif [ -f "$HOME/.ssh/chatappKeyPair.pem" ]; then
  KEY_FILE="$HOME/.ssh/chatappKeyPair.pem"
fi

if [ -n "$KEY_FILE" ]; then
  echo "✓ Found key file: $KEY_FILE"
  chmod 400 "$KEY_FILE" 2>/dev/null
  echo ""
  echo "Method 1: Direct SSH through bastion (if key is already on backend instance)"
  echo "  ssh -i $KEY_FILE -J ec2-user@$BASTION_PUBLIC_IP ec2-user@$BACKEND_PRIVATE_IP"
  echo ""
  echo "Method 2: Two-step connection"
  echo "  Step 1: ssh -i $KEY_FILE ec2-user@$BASTION_PUBLIC_IP"
  echo "  Step 2: ssh ec2-user@$BACKEND_PRIVATE_IP"
  echo ""
else
  echo "⚠ Key file (chatappKeyPair.pem) not found"
  echo ""
  echo "Method 1: Using EC2 Instance Connect (temporary key)"
  echo ""
  read -p "Do you want to use EC2 Instance Connect to add a temporary key? (y/n) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Check if public key exists
    PUB_KEY_FILE=""
    if [ -f "chatappKeyPair.pub" ]; then
      PUB_KEY_FILE="chatappKeyPair.pub"
    elif [ -f "../chatappKeyPair.pub" ]; then
      PUB_KEY_FILE="../chatappKeyPair.pub"
    elif [ -f "$HOME/.ssh/chatappKeyPair.pub" ]; then
      PUB_KEY_FILE="$HOME/.ssh/chatappKeyPair.pub"
    fi

    if [ -n "$PUB_KEY_FILE" ]; then
      echo "Adding temporary key via EC2 Instance Connect..."
      aws ec2-instance-connect send-ssh-public-key \
        --instance-id "$BACKEND_INSTANCE_ID" \
        --availability-zone "$BACKEND_AZ" \
        --instance-os-user ec2-user \
        --ssh-public-key "file://$PUB_KEY_FILE" \
        --region "$REGION" > /dev/null 2>&1

      if [ $? -eq 0 ]; then
        echo "✓ Temporary key added (valid for 60 seconds)"
        echo ""
        echo "Now connect via bastion:"
        echo "  ssh -i $PUB_KEY_FILE -J ec2-user@$BASTION_PUBLIC_IP ec2-user@$BACKEND_PRIVATE_IP"
        echo ""
        echo "Or if you have the private key:"
        echo "  ssh -i <private-key> -J ec2-user@$BASTION_PUBLIC_IP ec2-user@$BACKEND_PRIVATE_IP"
      else
        echo "✗ Failed to add temporary key. Make sure you have the public key file."
      fi
    else
      echo "✗ Public key file not found. Please provide chatappKeyPair.pub"
    fi
  fi

  echo ""
  echo "Method 2: Manual connection"
  echo "  1. First connect to bastion:"
  echo "     aws ssm start-session --target $BASTION_INSTANCE_ID --region $REGION"
  echo ""
  echo "  2. Then from bastion, connect to backend:"
  echo "     ssh ec2-user@$BACKEND_PRIVATE_IP"
  echo ""
  echo "Method 3: Using AWS Systems Manager Session Manager (no SSH key needed)"
  echo "  aws ssm start-session --target $BACKEND_INSTANCE_ID --region $REGION"
  echo ""
fi

echo ""
echo "=========================================="
echo "Quick Commands:"
echo "=========================================="
echo ""
echo "Connect via SSM (no key needed):"
echo "  aws ssm start-session --target $BACKEND_INSTANCE_ID --region $REGION"
echo ""
echo "Connect via bastion (if you have the key):"
echo "  ssh -i <key-file> -J ec2-user@$BASTION_PUBLIC_IP ec2-user@$BACKEND_PRIVATE_IP"
echo ""
echo "Check deployment status:"
echo "  aws deploy get-deployment --deployment-id d-RLV9L5LNG --region $REGION"
echo ""

