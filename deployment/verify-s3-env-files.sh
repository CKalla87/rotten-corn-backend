#!/bin/bash

# Script to verify S3 environment files for all environments
# Checks if env-file.zip exists and contains required variables

BUCKET="chattapplication1-env-files"
REGION="us-east-1"
TEMP_DIR="/tmp/s3-env-verify-$$"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "S3 Environment Files Verification"
echo "=========================================="
echo "Bucket: s3://${BUCKET}"
echo "Region: ${REGION}"
echo ""

# Create temp directory
mkdir -p "${TEMP_DIR}"

# Function to check an environment
check_environment() {
  local ENV=$1
  local ENV_PATH="${BUCKET}/${ENV}"
  
  echo "----------------------------------------"
  echo "Checking ${ENV} environment"
  echo "----------------------------------------"
  
  # Check if env-file.zip exists
  echo -n "Checking for env-file.zip... "
  if aws s3 ls "s3://${ENV_PATH}/env-file.zip" --region "${REGION}" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Found${NC}"
    
    # Download the zip file
    echo "Downloading env-file.zip..."
    if aws s3 cp "s3://${ENV_PATH}/env-file.zip" "${TEMP_DIR}/${ENV}-env-file.zip" --region "${REGION}" >/dev/null 2>&1; then
      echo -e "${GREEN}✓ Downloaded${NC}"
      
      # Extract to temp directory
      cd "${TEMP_DIR}"
      rm -rf "${ENV}-extract"
      mkdir -p "${ENV}-extract"
      unzip -q "${ENV}-env-file.zip" -d "${ENV}-extract" 2>/dev/null
      
      if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Extracted${NC}"
        echo ""
        echo "Files in env-file.zip:"
        ls -la "${ENV}-extract" | grep -E "\.env" | awk '{print "  - " $9 " (" $5 " bytes)"}'
        echo ""
        
        # Check for .env.{ENV} file
        ENV_FILE="${ENV}-extract/.env.${ENV}"
        if [ ! -f "${ENV_FILE}" ]; then
          # Try .env.production, .env.staging, .env.develop
          if [ -f "${ENV}-extract/.env.production" ]; then
            ENV_FILE="${ENV}-extract/.env.production"
          elif [ -f "${ENV}-extract/.env.staging" ]; then
            ENV_FILE="${ENV}-extract/.env.staging"
          elif [ -f "${ENV}-extract/.env.develop" ]; then
            ENV_FILE="${ENV}-extract/.env.develop"
          elif [ -f "${ENV}-extract/.env" ]; then
            ENV_FILE="${ENV}-extract/.env"
          fi
        fi
        
        if [ -f "${ENV_FILE}" ]; then
          echo "Checking ${ENV_FILE}..."
          echo ""
          
          # Check for DATABASE_URL
          echo -n "  DATABASE_URL: "
          if grep -q "^DATABASE_URL=" "${ENV_FILE}"; then
            DB_URL=$(grep "^DATABASE_URL=" "${ENV_FILE}" | head -1 | cut -d'=' -f2- | sed 's/mongodb:\/\/[^:]*:[^@]*@/mongodb:\/\/***:***@/')
            echo -e "${GREEN}✓ Found${NC} (${DB_URL})"
          else
            echo -e "${RED}✗ MISSING${NC}"
          fi
          
          # Check for NODE_ENV
          echo -n "  NODE_ENV: "
          if grep -q "^NODE_ENV=" "${ENV_FILE}"; then
            NODE_ENV_VALUE=$(grep "^NODE_ENV=" "${ENV_FILE}" | head -1 | cut -d'=' -f2 | tr -d '"' | tr -d "'" | xargs)
            if [ "${NODE_ENV_VALUE}" = "${ENV}" ]; then
              echo -e "${GREEN}✓ Found${NC} (${NODE_ENV_VALUE}) - ${GREEN}Correct${NC}"
            else
              echo -e "${YELLOW}⚠ Found${NC} (${NODE_ENV_VALUE}) - ${YELLOW}Should be '${ENV}'${NC}"
            fi
          else
            echo -e "${RED}✗ MISSING${NC}"
          fi
          
          # Check for REDIS_HOST
          echo -n "  REDIS_HOST: "
          if grep -q "^REDIS_HOST=" "${ENV_FILE}"; then
            REDIS_VALUE=$(grep "^REDIS_HOST=" "${ENV_FILE}" | head -1 | cut -d'=' -f2- | sed 's/=.*/=***/')
            echo -e "${GREEN}✓ Found${NC} (${REDIS_VALUE})"
          else
            echo -e "${YELLOW}⚠ Missing${NC} (optional but recommended)"
          fi
          
          # Check for JWT_TOKEN
          echo -n "  JWT_TOKEN: "
          if grep -q "^JWT_TOKEN=" "${ENV_FILE}"; then
            echo -e "${GREEN}✓ Found${NC}"
          else
            echo -e "${YELLOW}⚠ Missing${NC}"
          fi
          
          # Check for SECRET_KEY_ONE
          echo -n "  SECRET_KEY_ONE: "
          if grep -q "^SECRET_KEY_ONE=" "${ENV_FILE}"; then
            echo -e "${GREEN}✓ Found${NC}"
          else
            echo -e "${RED}✗ MISSING${NC}"
          fi
          
          # Count total variables
          VAR_COUNT=$(grep -c "^[A-Z_]*=" "${ENV_FILE}" 2>/dev/null || echo "0")
          echo ""
          echo "  Total environment variables: ${VAR_COUNT}"
          
        else
          echo -e "${RED}✗ ERROR: No .env file found in zip!${NC}"
          echo "  Available files:"
          ls -la "${ENV}-extract" | tail -n +2
        fi
      else
        echo -e "${RED}✗ Failed to extract zip file${NC}"
      fi
      
      cd - >/dev/null
    else
      echo -e "${RED}✗ Failed to download${NC}"
    fi
  else
    echo -e "${RED}✗ NOT FOUND${NC}"
    echo ""
    echo "  This environment is missing env-file.zip!"
    echo "  Expected location: s3://${ENV_PATH}/env-file.zip"
  fi
  
  # Check for any .env file directly in S3 (this shouldn't exist, but we check)
  echo ""
  echo -n "Checking for direct .env file in S3 (should not exist)... "
  if aws s3 ls "s3://${ENV_PATH}/.env" --region "${REGION}" >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Found${NC} (this could cause conflicts!)"
    echo "  Location: s3://${ENV_PATH}/.env"
    echo "  Note: The after_install.sh script removes this file, but it shouldn't be there."
  else
    echo -e "${GREEN}✓ Not found${NC} (good)"
  fi
  
  echo ""
}

# Check all environments
check_environment "develop"
check_environment "staging"
check_environment "production"

# Cleanup
rm -rf "${TEMP_DIR}"

echo "=========================================="
echo "Verification Complete"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - If DATABASE_URL is missing, the app will return 503"
echo "  - If NODE_ENV is wrong, the app may use wrong config"
echo "  - If env-file.zip is missing, deployment will fail"
echo ""
echo "To fix missing files, upload env-file.zip to:"
echo "  s3://${BUCKET}/develop/env-file.zip"
echo "  s3://${BUCKET}/staging/env-file.zip"
echo "  s3://${BUCKET}/production/env-file.zip"
echo ""

