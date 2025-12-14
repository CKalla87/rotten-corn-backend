#!/bin/bash

# Test that the built app can start and connect to MongoDB
# This simulates what happens in AWS CodeDeploy ApplicationStart hook

set -e

echo "=========================================="
echo "Testing Application Startup"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if .env.develop exists
if [ ! -f ".env.develop" ]; then
  echo -e "${RED}✗ .env.develop not found${NC}"
  echo "Please ensure .env.develop exists with required environment variables"
  exit 1
fi

# Load environment variables
export $(cat .env.develop | grep -v '^#' | xargs)

# Check if build exists
if [ ! -f "./build/src/app.js" ]; then
  echo -e "${RED}✗ Build not found. Run 'npm run build' first${NC}"
  exit 1
fi

echo "Step 1: Testing MongoDB connection"
echo "----------------------------------------"
node -e "
const mongoose = require('mongoose');
const url = process.env.DATABASE_URL || '';
console.log('Testing MongoDB connection...');
mongoose.connect(url)
  .then(() => {
    console.log('✓ MongoDB connection successful');
    mongoose.connection.close();
    process.exit(0);
  })
  .catch(e => {
    console.error('✗ MongoDB connection failed:', e.message);
    if (e.message.includes('buffermaxentries')) {
      console.error('  ERROR: buffermaxentries error still present!');
    }
    process.exit(1);
  });
" 2>&1

if [ $? -ne 0 ]; then
  echo -e "${RED}✗ MongoDB connection test failed${NC}"
  exit 1
fi
echo -e "${GREEN}✓ MongoDB connection test passed${NC}"

echo ""
echo "Step 2: Testing Redis connection string format"
echo "----------------------------------------"
if [ -z "$REDIS_HOST" ]; then
  echo -e "${YELLOW}⚠ REDIS_HOST not set (skipping Redis test)${NC}"
else
  if echo "$REDIS_HOST" | grep -q "chatapp-server-redis"; then
    echo -e "${GREEN}✓ REDIS_HOST points to correct endpoint${NC}"
  else
    echo -e "${YELLOW}⚠ REDIS_HOST may need updating: $REDIS_HOST${NC}"
  fi
fi

echo ""
echo "Step 3: Testing app module loading"
echo "----------------------------------------"
# Test that the app module can be loaded without errors
node -e "
require('dotenv').config({ path: '.env.develop' });
try {
  // Just test that the module can be required without syntax errors
  // Don't actually start the server
  const appModule = require('./build/src/app.js');
  console.log('✓ App module loaded successfully');
  process.exit(0);
} catch (e) {
  console.error('✗ App module load failed:', e.message);
  if (e.stack) {
    console.error('Stack:', e.stack.split('\n').slice(0, 5).join('\n'));
  }
  process.exit(1);
}
" 2>&1

if [ $? -ne 0 ]; then
  echo -e "${RED}✗ App module loading failed${NC}"
  exit 1
fi
echo -e "${GREEN}✓ App module loads successfully${NC}"

echo ""
echo "=========================================="
echo -e "${GREEN}✓ All startup tests passed!${NC}"
echo "=========================================="
echo ""
echo "The application is ready for deployment! 🚀"

