#!/bin/bash

# Add temporary key via EC2 Instance Connect
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-0a8d55fb21c492794 \
  --availability-zone us-east-1b \
  --instance-os-user ec2-user \
  --ssh-public-key file://chatappKeyPair.pub > /dev/null 2>&1

# Wait a moment for key to be active
sleep 2

# Connect through bastion and add key permanently
PUBLIC_KEY=$(cat chatappKeyPair.pub)
ssh -i chatappKeyPair.pem -o StrictHostKeyChecking=no ec2-user@18.209.214.225 << EOF
  echo "$PUBLIC_KEY" | ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 ec2-user@10.0.4.55 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo "Key added successfully" && hostname && pwd'
EOF

echo ""
echo "Now you can connect with:"
echo "ssh -i chatappKeyPair.pem -J ec2-user@18.209.214.225 ec2-user@10.0.4.55"

