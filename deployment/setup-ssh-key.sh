#!/bin/bash

# Setup SSH Key File for EC2 Access
# This script helps you set up your SSH key file for connecting to EC2 instances

KEY_NAME="chatappKeyPair"
REGION="us-east-1"
KEY_FILE="chatappKeyPair.pem"
PUB_KEY_FILE="chatappKeyPair.pub"

echo "=========================================="
echo "SSH Key Setup Guide"
echo "=========================================="
echo ""
echo "Key Pair Name: $KEY_NAME"
echo "Region: $REGION"
echo ""

# Check if key already exists locally
if [ -f "$KEY_FILE" ]; then
  echo "✓ Found existing key file: $KEY_FILE"
  chmod 400 "$KEY_FILE"
  echo "✓ Set correct permissions (400)"
  echo ""
  echo "Your key is ready to use!"
  exit 0
fi

if [ -f "$HOME/.ssh/$KEY_FILE" ]; then
  echo "✓ Found key file in ~/.ssh/: $HOME/.ssh/$KEY_FILE"
  chmod 400 "$HOME/.ssh/$KEY_FILE"
  echo "✓ Set correct permissions (400)"
  echo ""
  echo "Your key is ready to use!"
  exit 0
fi

echo "⚠ Private key file not found locally"
echo ""
echo "=========================================="
echo "Option 1: You Already Have the Key"
echo "=========================================="
echo ""
echo "If you have the private key file somewhere else:"
echo "  1. Copy it to this directory:"
echo "     cp /path/to/your/key.pem ./$KEY_FILE"
echo ""
echo "  2. Or copy to ~/.ssh/:"
echo "     cp /path/to/your/key.pem ~/.ssh/$KEY_FILE"
echo ""
echo "  3. Set correct permissions:"
echo "     chmod 400 $KEY_FILE"
echo ""
echo "=========================================="
echo "Option 2: Create a New Key Pair"
echo "=========================================="
echo ""
echo "⚠ WARNING: Creating a new key pair means you'll need to:"
echo "  1. Add the public key to existing instances, OR"
echo "  2. Launch new instances with the new key"
echo ""
read -p "Do you want to create a new key pair? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  # Check if key pair already exists in AWS
  KEY_EXISTS=$(aws ec2 describe-key-pairs --region "$REGION" --key-names "$KEY_NAME" 2>/dev/null)

  if [ $? -eq 0 ]; then
    echo "⚠ Key pair '$KEY_NAME' already exists in AWS"
    echo ""
    echo "You have two options:"
    echo "  A) Import your existing public key to AWS"
    echo "  B) Delete the old key pair and create a new one (requires updating instances)"
    echo ""
    read -p "Import existing public key? (y/n) " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
      if [ -f "$PUB_KEY_FILE" ]; then
        echo "Importing public key to AWS..."
        aws ec2 import-key-pair \
          --region "$REGION" \
          --key-name "$KEY_NAME" \
          --public-key-material "fileb://$PUB_KEY_FILE" \
          --output text

        if [ $? -eq 0 ]; then
          echo "✓ Public key imported successfully"
          echo "⚠ You still need the matching private key file: $KEY_FILE"
        else
          echo "✗ Failed to import public key"
        fi
      else
        echo "✗ Public key file ($PUB_KEY_FILE) not found"
        echo "Please provide the public key file first"
      fi
      exit 0
    fi
  fi

  # Generate new key pair
  echo "Generating new SSH key pair..."
  ssh-keygen -t rsa -b 4096 -f "$KEY_FILE" -N "" -C "chatapp-ec2-key"

  if [ $? -eq 0 ]; then
    echo "✓ Key pair generated successfully"
    chmod 400 "$KEY_FILE"
    echo "✓ Set correct permissions (400)"

    # Import public key to AWS
    echo ""
    echo "Importing public key to AWS..."
    aws ec2 import-key-pair \
      --region "$REGION" \
      --key-name "$KEY_NAME" \
      --public-key-material "fileb://$PUB_KEY_FILE" \
      --output text

    if [ $? -eq 0 ]; then
      echo "✓ Public key imported to AWS"
      echo ""
      echo "=========================================="
      echo "⚠ IMPORTANT: Next Steps"
      echo "=========================================="
      echo ""
      echo "Your new key pair is created, but existing instances"
      echo "are still using the old key. You need to:"
      echo ""
      echo "1. Add the new public key to existing instances:"
      echo "   - Connect via SSM Session Manager (no key needed)"
      echo "   - Or use EC2 Instance Connect to add the key temporarily"
      echo ""
      echo "2. Or update your launch template to use the new key"
      echo "   and launch new instances"
      echo ""
    else
      echo "✗ Failed to import public key to AWS"
      echo "You can import it manually later:"
      echo "  aws ec2 import-key-pair --region $REGION --key-name $KEY_NAME --public-key-material fileb://$PUB_KEY_FILE"
    fi
  else
    echo "✗ Failed to generate key pair"
    exit 1
  fi
else
  echo ""
  echo "=========================================="
  echo "Option 3: Use SSM Session Manager (No Key Needed)"
  echo "=========================================="
  echo ""
  echo "You can connect to instances without an SSH key using AWS Systems Manager:"
  echo ""
  echo "  aws ssm start-session --target <instance-id> --region $REGION"
  echo ""
  echo "This requires:"
  echo "  - SSM agent installed on instances (usually pre-installed on Amazon Linux)"
  echo "  - IAM permissions for SSM"
  echo ""
  echo "To check if an instance supports SSM:"
  echo "  aws ssm describe-instance-information --region $REGION"
  echo ""
fi

echo ""
echo "=========================================="
echo "Key File Locations"
echo "=========================================="
echo ""
echo "Private key: $KEY_FILE (or ~/.ssh/$KEY_FILE)"
echo "Public key:  $PUB_KEY_FILE (or ~/.ssh/$PUB_KEY_FILE)"
echo ""
echo "Once you have the key file, set permissions:"
echo "  chmod 400 $KEY_FILE"
echo ""

