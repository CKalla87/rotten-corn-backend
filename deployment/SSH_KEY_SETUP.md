# SSH Key Setup Guide

## Overview

To SSH into your EC2 instances, you need the private key file (`chatappKeyPair.pem`). AWS stores only the public key, so you must have the private key file locally.

## Current Status

- **Key Pair Name**: `chatappKeyPair`
- **Region**: `us-east-1`
- **Key Pair Exists in AWS**: ✅ Yes

## Option 1: Use Existing Key (If You Have It)

If you have the private key file somewhere else:

```bash
# Copy it to the project directory
cp /path/to/your/chatappKeyPair.pem ./chatappKeyPair.pem

# Or to ~/.ssh/
cp /path/to/your/chatappKeyPair.pem ~/.ssh/chatappKeyPair.pem

# Set correct permissions (required for SSH)
chmod 400 chatappKeyPair.pem
```

## Option 2: Create a New Key Pair

If you don't have the private key, you can create a new one:

```bash
# Run the setup script
cd deployment
./setup-ssh-key.sh
```

Or manually:

```bash
# Generate new key pair
ssh-keygen -t rsa -b 4096 -f chatappKeyPair.pem -N "" -C "chatapp-ec2-key"

# Set permissions
chmod 400 chatappKeyPair.pem

# Import public key to AWS
aws ec2 import-key-pair \
  --region us-east-1 \
  --key-name chatappKeyPair \
  --public-key-material fileb://chatappKeyPair.pub
```

⚠️ **Important**: After creating a new key pair, you'll need to:
1. Add the new public key to existing instances, OR
2. Launch new instances with the new key

## Option 3: Use SSM Session Manager (No Key Needed)

You can connect without an SSH key using AWS Systems Manager:

```bash
# Connect to backend instance
aws ssm start-session \
  --target i-07b8b7267334ba92d \
  --region us-east-1

# Connect to bastion host
aws ssm start-session \
  --target i-09052b67a653152ab \
  --region us-east-1
```

**Requirements**:
- SSM agent installed on instances (pre-installed on Amazon Linux)
- IAM permissions for SSM (should already be configured)

## Option 4: Use EC2 Instance Connect (Temporary)

EC2 Instance Connect allows temporary SSH access without managing keys:

```bash
# Add temporary key (valid for 60 seconds)
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-07b8b7267334ba92d \
  --availability-zone us-east-1b \
  --instance-os-user ec2-user \
  --ssh-public-key file://~/.ssh/id_rsa.pub \
  --region us-east-1

# Then connect via bastion
ssh -i ~/.ssh/id_rsa -J ec2-user@98.92.178.139 ec2-user@10.0.4.55
```

## Quick Reference

### Instance Information

**Bastion Host:**
- Instance ID: `i-09052b67a653152ab`
- Public IP: `98.92.178.139`
- Private IP: `10.0.1.144`

**Backend Instance:**
- Instance ID: `i-07b8b7267334ba92d`
- Private IP: `10.0.4.55`
- Availability Zone: `us-east-1b`

### SSH Connection Commands

**With key file:**
```bash
# Direct connection through bastion
ssh -i chatappKeyPair.pem -J ec2-user@98.92.178.139 ec2-user@10.0.4.55

# Two-step connection
ssh -i chatappKeyPair.pem ec2-user@98.92.178.139
# Then from bastion:
ssh ec2-user@10.0.4.55
```

**Without key file (SSM):**
```bash
aws ssm start-session --target i-07b8b7267334ba92d --region us-east-1
```

## Troubleshooting

### Permission Denied
```bash
# Make sure permissions are correct
chmod 400 chatappKeyPair.pem
```

### Key Not Found
- Check if the key file exists: `ls -la chatappKeyPair.pem`
- Verify the key name matches: `chatappKeyPair`
- Check if key is in a different location: `find ~ -name "chatappKeyPair.pem"`

### SSM Not Working
- Verify SSM agent is running on the instance
- Check IAM permissions for SSM
- Ensure the instance has the required IAM role attached

## Helper Scripts

- `./setup-ssh-key.sh` - Interactive key setup script
- `./ssh-to-instance.sh` - SSH connection helper script

