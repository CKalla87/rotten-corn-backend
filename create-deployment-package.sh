#!/bin/bash

# Create a minimal deployment package for CodeDeploy
# Excludes node_modules and other large/unnecessary files

echo "Creating deployment package..."

# Remove old zip if it exists
rm -f chatapp.zip

# Create zip excluding large directories and files
zip -r chatapp.zip . \
  -x "node_modules/*" \
  -x ".git/*" \
  -x "*.log" \
  -x "coverage/*" \
  -x "build/*" \
  -x ".env*" \
  -x "dump.rdb" \
  -x "*.zip" \
  -x "usr/*" \
  -x ".terraform/*" \
  -x "deployment/.terraform/*" \
  -x "deployment/*.tfstate*" \
  -x "deployment/*.tfvars" \
  -x "deployment/*.pub" \
  -x "deployment/*.rsa" \
  -x "deployment/connect-to-instance.sh" \
  -x "deployment/CONNECTION_INSTRUCTIONS.txt" \
  -x "deployment/verify-codedeploy.sh" \
  -x "deployment/check-deployment-status.sh" \
  -x "deployment/create-deployment.sh" \
  -x "*.map" \
  -x ".DS_Store" \
  -x "*.swp" \
  -x "*.swo" \
  -x "*~"

if [ -f chatapp.zip ]; then
  SIZE=$(ls -lh chatapp.zip | awk '{print $5}')
  echo "✓ Created chatapp.zip ($SIZE)"
  echo ""
  echo "To upload to S3:"
  echo "  aws --region us-east-1 s3 cp chatapp.zip s3://chatapp-server-default-app-602951639614/"
else
  echo "✗ Failed to create chatapp.zip"
  exit 1
fi

