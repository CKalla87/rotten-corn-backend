#!/bin/bash

# Script to fix develop environment issues:
# 1. Remove conflicting .env file from S3
# 2. Fix NODE_ENV in env-file.zip (if needed)

BUCKET="chattapplication1-env-files"
REGION="us-east-1"
ENV="develop"
TEMP_DIR="/tmp/fix-develop-env-$$"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "Fixing Develop Environment Issues"
echo "=========================================="
echo ""

# Create temp directory
mkdir -p "${TEMP_DIR}"
cd "${TEMP_DIR}"

# Step 1: Remove conflicting .env file from S3
echo "Step 1: Removing conflicting .env file from S3..."
if aws s3 rm "s3://${BUCKET}/${ENV}/.env" --region "${REGION}" 2>/dev/null; then
  echo -e "${GREEN}✓ Removed conflicting .env file from S3${NC}"
else
  echo -e "${YELLOW}⚠ Could not remove .env file (may not exist or already removed)${NC}"
fi
echo ""

# Step 2: Download and fix env-file.zip
echo "Step 2: Fixing NODE_ENV in env-file.zip..."
if aws s3 cp "s3://${BUCKET}/${ENV}/env-file.zip" "${TEMP_DIR}/env-file.zip" --region "${REGION}" >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Downloaded env-file.zip${NC}"
  
  # Extract
  unzip -q env-file.zip 2>/dev/null
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Extracted env-file.zip${NC}"
    
    # Find the develop env file
    ENV_FILE=""
    if [ -f ".env.${ENV}" ]; then
      ENV_FILE=".env.${ENV}"
    elif [ -f ".env.develop" ]; then
      ENV_FILE=".env.develop"
    elif [ -f ".env" ]; then
      ENV_FILE=".env"
    fi
    
    if [ -n "${ENV_FILE}" ] && [ -f "${ENV_FILE}" ]; then
      echo "Found env file: ${ENV_FILE}"
      
      # Check and fix NODE_ENV
      if grep -q "^NODE_ENV=" "${ENV_FILE}"; then
        CURRENT_NODE_ENV=$(grep "^NODE_ENV=" "${ENV_FILE}" | head -1 | cut -d'=' -f2 | tr -d '"' | tr -d "'" | xargs)
        echo "Current NODE_ENV: ${CURRENT_NODE_ENV}"
        
        if [ "${CURRENT_NODE_ENV}" != "${ENV}" ]; then
          echo "Updating NODE_ENV from '${CURRENT_NODE_ENV}' to '${ENV}'..."
          sed -i.bak "s/^NODE_ENV=.*/NODE_ENV=${ENV}/" "${ENV_FILE}"
          rm -f "${ENV_FILE}.bak"
          echo -e "${GREEN}✓ Updated NODE_ENV to '${ENV}'${NC}"
          
          # Recreate zip file
          rm -f env-file.zip
          zip -q env-file.zip .env* 2>/dev/null
          
          if [ -f env-file.zip ]; then
            echo "Re-uploading fixed env-file.zip..."
            if aws s3 cp env-file.zip "s3://${BUCKET}/${ENV}/env-file.zip" --region "${REGION}" >/dev/null 2>&1; then
              echo -e "${GREEN}✓ Uploaded fixed env-file.zip to S3${NC}"
              echo ""
              echo -e "${GREEN}SUCCESS: Develop environment files have been fixed!${NC}"
              echo ""
              echo "Next steps:"
              echo "  1. Redeploy develop environment to apply the changes"
              echo "  2. The after_install.sh script will now use the correct NODE_ENV"
            else
              echo -e "${RED}✗ Failed to upload fixed env-file.zip${NC}"
              exit 1
            fi
          else
            echo -e "${RED}✗ Failed to recreate zip file${NC}"
            exit 1
          fi
        else
          echo -e "${GREEN}✓ NODE_ENV is already correct (${ENV})${NC}"
          echo "No changes needed."
        fi
      else
        echo -e "${YELLOW}⚠ NODE_ENV not found, adding it...${NC}"
        echo "NODE_ENV=${ENV}" >> "${ENV_FILE}"
        
        # Recreate zip file
        rm -f env-file.zip
        zip -q env-file.zip .env* 2>/dev/null
        
        if [ -f env-file.zip ]; then
          aws s3 cp env-file.zip "s3://${BUCKET}/${ENV}/env-file.zip" --region "${REGION}" >/dev/null 2>&1
          echo -e "${GREEN}✓ Added NODE_ENV and uploaded to S3${NC}"
        fi
      fi
    else
      echo -e "${RED}✗ Could not find env file in zip${NC}"
      exit 1
    fi
  else
    echo -e "${RED}✗ Failed to extract zip file${NC}"
    exit 1
  fi
else
  echo -e "${RED}✗ Failed to download env-file.zip${NC}"
  exit 1
fi

# Cleanup
cd - >/dev/null
rm -rf "${TEMP_DIR}"

echo ""
echo "=========================================="
echo "Fix Complete"
echo "=========================================="

