#!/bin/bash

# Update existing deployment package with only changed files
# Downloads existing zip, updates appspec.yml and scripts, re-zips, and uploads

BUCKET="chatapp-server-default-app-602951639614"
KEY="chatapp.zip"
REGION="us-east-1"
TEMP_DIR="/tmp/codedeploy-update-$$"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Downloading existing package from S3..."
aws s3 cp s3://${BUCKET}/${KEY} /tmp/chatapp-existing.zip --region ${REGION}

if [ ! -f /tmp/chatapp-existing.zip ]; then
  echo "✗ Failed to download existing package. Creating new package instead."
  ./create-deployment-package.sh
  exit 0
fi

echo "Extracting existing package..."
mkdir -p ${TEMP_DIR}
cd ${TEMP_DIR}
unzip -q /tmp/chatapp-existing.zip

echo "Updating appspec.yml and scripts..."
# Copy updated files from project root
cp ${SCRIPT_DIR}/appspec.yml .
cp -r ${SCRIPT_DIR}/scripts .

echo "Creating updated package..."
zip -q -r /tmp/chatapp-updated.zip .

cd ${SCRIPT_DIR}
mv /tmp/chatapp-updated.zip chatapp.zip

# Cleanup
rm -rf ${TEMP_DIR}
rm /tmp/chatapp-existing.zip

SIZE=$(ls -lh chatapp.zip | awk '{print $5}')
echo "✓ Created updated chatapp.zip ($SIZE)"
echo ""
echo "Uploading to S3..."
aws s3 cp chatapp.zip s3://${BUCKET}/${KEY} --region ${REGION}

if [ $? -eq 0 ]; then
  echo "✓ Successfully uploaded to S3"
  echo ""
  echo "You can now create a new deployment:"
  echo "  ./deployment/create-deployment.sh"
else
  echo "✗ Failed to upload to S3"
  exit 1
fi

