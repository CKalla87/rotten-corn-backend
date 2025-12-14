#!/bin/bash

# Test deployment build process locally
# This simulates what happens in AWS CodeDeploy AfterInstall hook

set -e

echo "=========================================="
echo "Testing Deployment Build Process"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track if we need to restore node_modules
RESTORE_NODE_MODULES=false
if [ -d "node_modules" ]; then
  echo -e "${YELLOW}⚠ Backing up existing node_modules...${NC}"
  mv node_modules node_modules.backup
  RESTORE_NODE_MODULES=true
fi

# Step 1: Clean install (simulating deployment)
echo ""
echo "Step 1: Clean npm install (production only)"
echo "----------------------------------------"
if [ -f "package-lock.json" ]; then
  echo "Using npm ci (faster, more reliable)..."
  npm ci --production
else
  echo "Using npm install (no package-lock.json)..."
  npm install --production
fi

if [ $? -ne 0 ]; then
  echo -e "${RED}✗ npm install failed${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Step 2: Verify critical dependencies
echo ""
echo "Step 2: Verifying critical dependencies"
echo "----------------------------------------"
MISSING_DEPS=""
for dep in express passport dotenv mongoose; do
  if [ ! -d "node_modules/$dep" ]; then
    MISSING_DEPS="$MISSING_DEPS $dep"
  fi
done

if [ -n "$MISSING_DEPS" ]; then
  echo -e "${RED}✗ Missing dependencies:$MISSING_DEPS${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Critical dependencies verified${NC}"

# Step 3: Install build dependencies
echo ""
echo "Step 3: Installing build dependencies"
echo "----------------------------------------"
npm install ttypescript typescript --save-dev --no-save

if [ $? -ne 0 ]; then
  echo -e "${RED}✗ Build dependencies installation failed${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Build dependencies installed${NC}"

# Step 4: Build application
echo ""
echo "Step 4: Building application"
echo "----------------------------------------"
npm run build

if [ $? -ne 0 ]; then
  echo -e "${RED}✗ Build failed${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Build completed${NC}"

# Step 5: Verify build output
echo ""
echo "Step 5: Verifying build output"
echo "----------------------------------------"
if [ ! -f "./build/src/app.js" ]; then
  echo -e "${RED}✗ Build output not found at ./build/src/app.js${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Build output verified: ./build/src/app.js exists${NC}"

# Step 6: Test that the built app can start (basic syntax check)
echo ""
echo "Step 6: Testing built application (syntax check)"
echo "----------------------------------------"
node -c ./build/src/app.js 2>&1

if [ $? -ne 0 ]; then
  echo -e "${RED}✗ Built app has syntax errors${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Built app syntax is valid${NC}"

# Step 7: Check for MongoDB connection code
echo ""
echo "Step 7: Verifying MongoDB connection fix"
echo "----------------------------------------"
if grep -q "bufferCommands" ./build/src/setupDatabase.js; then
  echo -e "${GREEN}✓ MongoDB bufferCommands fix is in build${NC}"
else
  echo -e "${YELLOW}⚠ bufferCommands fix not found in build (may need rebuild)${NC}"
fi

# Check that we're removing buffermaxentries (it's OK if it's in the code as a string to remove)
if grep -q "replace.*buffermaxentries" ./build/src/setupDatabase.js; then
  echo -e "${GREEN}✓ buffermaxentries removal code is in build${NC}"
else
  echo -e "${YELLOW}⚠ buffermaxentries removal code not found${NC}"
fi

# Check that we're not passing buffermaxentries as an option
if grep -q "buffermaxentries.*:" ./build/src/setupDatabase.js; then
  echo -e "${RED}✗ buffermaxentries option found in build!${NC}"
  exit 1
else
  echo -e "${GREEN}✓ No buffermaxentries option being set${NC}"
fi

# Cleanup
echo ""
echo "=========================================="
echo -e "${GREEN}✓ All deployment build steps passed!${NC}"
echo "=========================================="
echo ""

# Restore node_modules if we backed it up
if [ "$RESTORE_NODE_MODULES" = true ]; then
  echo -e "${YELLOW}Restoring original node_modules...${NC}"
  rm -rf node_modules
  mv node_modules.backup node_modules
  echo -e "${GREEN}✓ Restored${NC}"
fi

echo ""
echo "Ready for deployment! 🚀"

