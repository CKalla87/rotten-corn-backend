#!/bin/bash
# Use set -e carefully - we want to catch errors but not exit on npm timeouts
set -e

# CodeDeploy AfterInstall hook
# This script runs after the application files are extracted
# The current working directory is the deployment archive location

# Trap to catch termination signals and log them
# Exit code 244 might be from CodeDeploy timeout, so we log it
trap 'EXIT_CODE=$?; echo "[$(date)] Script received signal or exited with code: $EXIT_CODE"; if [ $EXIT_CODE -eq 244 ] || [ $EXIT_CODE -eq 124 ]; then echo "[$(date)] WARNING: This might be a timeout issue"; fi; exit $EXIT_CODE' EXIT INT TERM

DEPLOYMENT_DIR="/home/ec2-user/rotten-corn-backend"
mkdir -p "$DEPLOYMENT_DIR"

echo "[$(date)] Using deployment directory $DEPLOYMENT_DIR"
if [ ! -d "$DEPLOYMENT_DIR" ]; then
  echo "[$(date)] ERROR: $DEPLOYMENT_DIR does not exist after copy phase"
  exit 1
fi

cd "$DEPLOYMENT_DIR"
echo "[$(date)] Changed to $DEPLOYMENT_DIR"
echo "[$(date)] Verifying we're in the right directory..."
echo "[$(date)] Current directory: $(pwd)"
echo "[$(date)] Directory should be: $DEPLOYMENT_DIR"

if [ "$(pwd)" != "$DEPLOYMENT_DIR" ]; then
  echo "[$(date)] ERROR: Not in expected directory!"
  exit 1
fi

# Fix: Verify critical source files were extracted correctly
# CodeDeploy sometimes extracts files as 0 bytes - restore from archive if needed
echo "[$(date)] Verifying source files were extracted correctly..."
DEPLOYMENT_ARCHIVE="/opt/codedeploy-agent/deployment-root/*/d-*/deployment-archive"
ARCHIVE_PATH=$(find /opt/codedeploy-agent/deployment-root -type d -name "deployment-archive" -path "*/d-*" 2>/dev/null | sort -t'/' -k10 | tail -1)

if [ -n "$ARCHIVE_PATH" ] && [ -d "$ARCHIVE_PATH" ]; then
  echo "[$(date)] Found deployment archive: $ARCHIVE_PATH"

  # Check and fix critical source files if they're 0 bytes or missing
  CRITICAL_FILES=("src/setupDatabase.ts" "src/app.ts" "package.json" "tsconfig.json")
  for file in "${CRITICAL_FILES[@]}"; do
    if [ ! -f "$file" ] || [ ! -s "$file" ]; then
      echo "[$(date)] WARNING: $file is missing or 0 bytes, restoring from archive..."
      if [ -f "$ARCHIVE_PATH/$file" ] && [ -s "$ARCHIVE_PATH/$file" ]; then
        # Create directory if it doesn't exist (for files in subdirectories like src/)
        file_dir=$(dirname "$file")
        if [ "$file_dir" != "." ] && [ ! -d "$file_dir" ]; then
          mkdir -p "$file_dir"
          echo "[$(date)] Created directory: $file_dir"
        fi
        cp "$ARCHIVE_PATH/$file" "$file"
        echo "[$(date)] ✓ Restored $file from archive ($(wc -c < "$file") bytes)"
      else
        echo "[$(date)] ERROR: $file not found in archive either!"
      fi
    else
      echo "[$(date)] ✓ $file is valid ($(wc -c < "$file") bytes)"
    fi
  done

  # Check if src directory has required structure - restore if missing critical parts
  NEEDS_RESTORE=false
  REQUIRED_PATHS=("src/config.ts" "src/setupServer.ts" "src/shared" "src/features")
  for path in "${REQUIRED_PATHS[@]}"; do
    if [ ! -e "$path" ]; then
      echo "[$(date)] WARNING: Required path missing: $path"
      NEEDS_RESTORE=true
    fi
  done

  if [ "$NEEDS_RESTORE" = true ] && [ -d "$ARCHIVE_PATH/src" ]; then
    echo "[$(date)] WARNING: src directory is incomplete, restoring from archive..."
    echo "[$(date)] Current src directory contents:"
    find src -type f 2>/dev/null | head -20 || echo "src is empty or missing"
    echo "[$(date)] Archive src directory contents:"
    find "$ARCHIVE_PATH/src" -type f 2>/dev/null | head -30 || echo "Cannot list archive src"
    echo "[$(date)] Archive src directory size: $(du -sh "$ARCHIVE_PATH/src" 2>/dev/null || echo 'unknown')"
    
    echo "[$(date)] Restoring entire src directory from archive..."
    # Remove existing incomplete src and restore from archive
    rm -rf src
    if cp -r "$ARCHIVE_PATH/src" . 2>&1; then
      if [ -d "src" ]; then
        FILE_COUNT=$(find src -type f 2>/dev/null | wc -l)
        echo "[$(date)] ✓ Restored src directory with $FILE_COUNT files"
        echo "[$(date)] Restored src structure (first 30 files):"
        find src -type f 2>/dev/null | head -30
        echo "[$(date)] Verifying critical files after restore:"
        for path in "${REQUIRED_PATHS[@]}"; do
          if [ -e "$path" ]; then
            echo "[$(date)]   ✓ $path exists"
          else
            echo "[$(date)]   ✗ $path still missing!"
          fi
        done
      else
        echo "[$(date)] ERROR: Failed to restore src directory - directory not created"
        exit 1
      fi
    else
      echo "[$(date)] ERROR: Failed to copy src directory from archive"
      exit 1
    fi
  elif [ "$NEEDS_RESTORE" = true ]; then
    echo "[$(date)] ERROR: src directory incomplete and archive src not found!"
    echo "[$(date)] Archive path: $ARCHIVE_PATH"
    echo "[$(date)] Archive contents:"
    ls -la "$ARCHIVE_PATH" 2>/dev/null | head -20 || echo "Cannot list archive"
    exit 1
  else
    echo "[$(date)] ✓ src directory exists with required structure"
  fi
else
  echo "[$(date)] WARNING: Could not find deployment archive to verify files"
fi

# Clean up old environment files
echo "[$(date)] Cleaning up old environment files"
rm -rf env-file.zip .env .env.production

# Download and extract environment files
ENV_BUCKET="chattapplication1-env-files"

# Detect environment from CodeDeploy deployment group name
# CodeDeploy automatically provides DEPLOYMENT_GROUP_NAME environment variable
# Deployment group names follow pattern: ${prefix}-group
# Examples: chatapp-develop-group, chatapp-staging-group, chatapp-production-group
ENV_PREFIX=""

if [ -n "$DEPLOYMENT_GROUP_NAME" ]; then
  # Extract environment from deployment group name
  # Pattern: extract "develop", "staging", or "production" from group name
  if echo "$DEPLOYMENT_GROUP_NAME" | grep -qE "-(develop|staging|production)-group"; then
    ENV_PREFIX=$(echo "$DEPLOYMENT_GROUP_NAME" | sed -E 's/.*-(develop|staging|production)-group.*/\1/')
    echo "[$(date)] Detected environment from DEPLOYMENT_GROUP_NAME: ${ENV_PREFIX}"
  fi
fi

# Fallback: try to detect from S3 bucket structure
if [ -z "$ENV_PREFIX" ]; then
  echo "[$(date)] DEPLOYMENT_GROUP_NAME not available or doesn't match pattern, checking S3..."
  for env in develop staging production; do
    if aws s3 ls "s3://${ENV_BUCKET}/${env}/" >/dev/null 2>&1; then
      # Check if this is the only environment folder (likely the correct one)
      ENV_PREFIX="$env"
      echo "[$(date)] Found environment folder in S3: ${env}"
      break
    fi
  done
fi

# Ultimate fallback: default to staging (but log warning)
if [ -z "$ENV_PREFIX" ]; then
  ENV_PREFIX="staging"
  echo "[$(date)] WARNING: Could not detect environment, defaulting to staging"
  echo "[$(date)] DEPLOYMENT_GROUP_NAME was: ${DEPLOYMENT_GROUP_NAME:-not set}"
fi

echo "[$(date)] Using environment: ${ENV_PREFIX}"

echo "[$(date)] Downloading environment files from S3 bucket ${ENV_BUCKET}/${ENV_PREFIX}"
if ! aws s3 sync "s3://${ENV_BUCKET}/${ENV_PREFIX}" . 2>&1; then
  echo "[$(date)] ERROR: Failed to sync from S3 - this will cause app startup to fail!"
  echo "[$(date)] Attempting to continue, but app may crash if .env is missing"
fi

if [ -f env-file.zip ]; then
  echo "[$(date)] Extracting environment files"
  unzip -o env-file.zip
  # Select environment file based on detected environment
  # Priority: .env.{ENV_PREFIX} > .env.production > .env
  ENV_FILE_COPIED=false

  if [ -f ".env.${ENV_PREFIX}" ]; then
    cp ".env.${ENV_PREFIX}" .env
    echo "[$(date)] Copied .env.${ENV_PREFIX} to .env (${ENV_PREFIX} environment)"
    ENV_FILE_COPIED=true
  elif [ -f .env.production ] && [ "$ENV_PREFIX" = "production" ]; then
    cp .env.production .env
    echo "[$(date)] Copied .env.production to .env (production environment)"
    ENV_FILE_COPIED=true
  elif [ -f .env.staging ] && [ "$ENV_PREFIX" = "staging" ]; then
    cp .env.staging .env
    echo "[$(date)] Copied .env.staging to .env (staging environment)"
    ENV_FILE_COPIED=true
  elif [ -f .env.develop ] && [ "$ENV_PREFIX" = "develop" ]; then
    cp .env.develop .env
    echo "[$(date)] Copied .env.develop to .env (develop environment)"
    ENV_FILE_COPIED=true
  elif [ -f .env ]; then
    echo "[$(date)] Using existing .env file (no environment-specific file found)"
    ENV_FILE_COPIED=true
  fi

  if [ "$ENV_FILE_COPIED" = false ]; then
    echo "[$(date)] ERROR: No .env file found for environment ${ENV_PREFIX}!"
    echo "[$(date)] Expected one of: .env.${ENV_PREFIX}, .env.production, .env.staging, .env.develop, or .env"
    exit 1
  fi
else
  echo "[$(date)] ERROR: env-file.zip not found in S3 bucket ${ENV_BUCKET}/${ENV_PREFIX}"
  echo "[$(date)] App will likely fail to start without environment variables"
fi

# Verify critical environment variables exist
if [ -f .env ]; then
  echo "[$(date)] Verifying critical environment variables..."
  if ! grep -q "DATABASE_URL" .env; then
    echo "[$(date)] ERROR: DATABASE_URL not found in .env file!"
  else
    echo "[$(date)] ✓ DATABASE_URL found in .env"
  fi
else
  echo "[$(date)] ERROR: .env file does not exist - app will crash on startup!"
fi

# Ensure Node.js and npm are in PATH
# DO NOT include /opt/nodejs paths - they don't exist and break PM2
# CRITICAL: Include /bin and /usr/bin for shell commands (sh, bash) needed by npm postinstall scripts
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin:$PATH"

# Verify essential shell commands are available (needed for npm postinstall scripts)
if ! command -v sh >/dev/null 2>&1; then
  echo "[$(date)] WARNING: sh command not found in PATH"
  echo "[$(date)] PATH: $PATH"
  echo "[$(date)] Searching for sh..."
  if [ -f /bin/sh ]; then
    export PATH="/bin:$PATH"
    echo "[$(date)] Added /bin to PATH"
  elif [ -f /usr/bin/sh ]; then
    export PATH="/usr/bin:$PATH"
    echo "[$(date)] Added /usr/bin to PATH"
  fi
fi

# Verify sh is now available
if ! command -v sh >/dev/null 2>&1; then
  echo "[$(date)] ERROR: sh command still not found after PATH adjustment"
  echo "[$(date)] PATH: $PATH"
  echo "[$(date)] Checking for sh in common locations:"
  ls -la /bin/sh /usr/bin/sh 2>&1 || echo "sh not found in common locations"
  exit 1
fi

echo "[$(date)] ✓ Shell commands verified: sh=$(command -v sh)"

# Stop any existing PM2 processes
if ! command -v npm >/dev/null 2>&1; then
  NODE_VERSION="16.20.2"
  NODE_DIST="node-v${NODE_VERSION}-linux-x64"
  # Use system Node.js, not /opt/nodejs (which doesn't exist)
  NODE_INSTALL_DIR="/usr/local"

  echo "[$(date)] Installing Node.js ${NODE_VERSION} from official tarball"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.tar.xz" -o /tmp/node.tar.xz
  mkdir -p "${NODE_INSTALL_DIR}"
  tar -xJf /tmp/node.tar.xz -C "${NODE_INSTALL_DIR}"
  for target in /usr/local/bin /usr/bin; do
    ln -sf "${NODE_INSTALL_DIR}/${NODE_DIST}/bin/node" "${target}/node"
    ln -sf "${NODE_INSTALL_DIR}/${NODE_DIST}/bin/npm" "${target}/npm"
    ln -sf "${NODE_INSTALL_DIR}/${NODE_DIST}/bin/npx" "${target}/npx"
  done
  export PATH="/usr/local/bin:/usr/bin:${NODE_INSTALL_DIR}/${NODE_DIST}/bin:$PATH"
  rm -f /tmp/node.tar.xz
fi

# Verify npm is accessible
if ! command -v npm >/dev/null 2>&1; then
  echo "[$(date)] ERROR: npm not found in PATH after installation attempt"
  echo "[$(date)] PATH: $PATH"
  echo "[$(date)] which npm: $(which npm 2>&1 || echo 'not found')"
  exit 1
fi

echo "[$(date)] npm version: $(npm --version)"
echo "[$(date)] node version: $(node --version)"

echo "[$(date)] Ensuring PM2 is installed"
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2 --unsafe-perm
fi

echo "[$(date)] Stopping existing PM2 processes"
pm2 delete all || true

# Install dependencies
echo "[$(date)] Installing npm dependencies"
echo "[$(date)] Current directory: $(pwd)"
echo "[$(date)] Checking if package.json exists:"
if [ ! -f package.json ]; then
  echo "[$(date)] ERROR: package.json not found in $(pwd)"
  exit 1
fi

echo "[$(date)] Running npm install..."
echo "[$(date)] Working directory: $(pwd)"
echo "[$(date)] Node version: $(node --version 2>&1)"
echo "[$(date)] NPM version: $(npm --version 2>&1)"
echo "[$(date)] Checking package.json exists..."
if [ ! -f package.json ]; then
  echo "[$(date)] ERROR: package.json not found in $(pwd)"
  echo "[$(date)] Directory contents:"
  ls -la
  exit 1
fi
echo "[$(date)] package.json found. Checking dependencies..."
grep -A 5 '"dependencies"' package.json | head -10 || echo "Could not read dependencies from package.json"

# Clean install - remove only node_modules, keep package-lock.json for faster installs
echo "[$(date)] Removing old node_modules (keeping package-lock.json for faster install)..."
rm -rf node_modules 2>/dev/null || true
echo "[$(date)] Cleanup complete"

# Configure npm to use less memory to prevent ENOMEM errors
echo "[$(date)] Configuring npm for low-memory environments..."
export NODE_OPTIONS="--max-old-space-size=512"
npm config set maxsockets 1
npm config set fetch-retries 3
npm config set fetch-retry-mintimeout 20000
npm config set fetch-retry-maxtimeout 120000

# Configure npm to handle postinstall script failures gracefully
# Some packages (like core-js) may have postinstall scripts that fail in certain environments
npm config set ignore-scripts false
npm config set script-shell /bin/sh

# Verify shell is accessible for npm scripts
echo "[$(date)] Verifying shell for npm scripts..."
if ! command -v sh >/dev/null 2>&1; then
  echo "[$(date)] ERROR: sh not found - npm postinstall scripts will fail"
  exit 1
fi
echo "[$(date)] ✓ Shell verified: $(command -v sh)"

# Check available memory
echo "[$(date)] System memory info:"
free -h || echo "free command not available"
echo "[$(date)] Available disk space:"
df -h . || echo "df command not available"

# Check if swap exists, create if needed to prevent ENOMEM
if ! swapon --show | grep -q .; then
  echo "[$(date)] No swap space detected, checking if we can create one..."
  if [ -f /swapfile ] || [ -b /dev/nvme1n1 ]; then
    echo "[$(date)] Swap file/device already exists, skipping creation"
  else
    # Try to create a 2GB swap file if we have enough disk space
    AVAILABLE_SPACE=$(df / | tail -1 | awk '{print $4}')
    if [ "$AVAILABLE_SPACE" -gt 2097152 ]; then  # 2GB in KB
      echo "[$(date)] Creating 2GB swap file to prevent memory issues..."
      fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1024 count=2097152 2>/dev/null
      chmod 600 /swapfile
      mkswap /swapfile
      swapon /swapfile
      echo "[$(date)] ✓ Swap file created and activated"
    else
      echo "[$(date)] WARNING: Not enough disk space to create swap file"
    fi
  fi
else
  echo "[$(date)] Swap space already active"
fi

# Use npm ci if package-lock.json exists (faster, more reliable, deterministic)
# npm ci is 2-3x faster than npm install and more reliable
if [ -f "package-lock.json" ]; then
  echo "[$(date)] package-lock.json found - using npm ci (faster and more reliable)..."
  echo "[$(date)] Running: npm ci --production (with memory optimizations)"
  echo "[$(date)] npm ci should take 2-5 minutes (much faster than npm install)..."

  # Run npm ci - disable set -e temporarily to handle errors gracefully
  set +e
  npm ci --production --prefer-offline --no-audit --ignore-scripts=false 2>&1 | tee /tmp/npm-install.log
  NPM_EXIT_CODE=${PIPESTATUS[0]}
  set -e

  if [ $NPM_EXIT_CODE -ne 0 ]; then
    echo "[$(date)] npm ci failed with exit code $NPM_EXIT_CODE"
    echo "[$(date)] Checking error details..."
    grep -i "enoent\|spawn\|sh" /tmp/npm-install.log | tail -20 || echo "No shell-related errors found"
    
    echo "[$(date)] This might be due to package-lock.json mismatch or postinstall script issues, trying npm install as fallback..."

    # Fallback to npm install with memory optimizations
    # Try with ignore-scripts if postinstall scripts are failing
    set +e
    npm install --production --prefer-offline --no-audit --ignore-scripts=false 2>&1 | tee -a /tmp/npm-install.log
    NPM_EXIT_CODE=${PIPESTATUS[0]}
    set -e

    if [ $NPM_EXIT_CODE -ne 0 ]; then
      echo "[$(date)] npm install also failed, trying with ignore-scripts as last resort..."
      set +e
      npm install --production --prefer-offline --no-audit --ignore-scripts 2>&1 | tee -a /tmp/npm-install.log
      NPM_EXIT_CODE=${PIPESTATUS[0]}
      set -e
      
      if [ $NPM_EXIT_CODE -ne 0 ]; then
        echo "[$(date)] ERROR: All npm install attempts failed"
        echo "[$(date)] Last 100 lines of npm output:"
        tail -100 /tmp/npm-install.log
        echo "[$(date)] Checking if partial node_modules exists:"
        ls -la node_modules 2>&1 | head -20 || echo "node_modules does not exist"
        exit 1
      else
        echo "[$(date)] ⚠ npm install succeeded with --ignore-scripts (some postinstall scripts were skipped)"
      fi
    fi
  fi
else
  echo "[$(date)] No package-lock.json found - using npm install..."
  echo "[$(date)] Running: npm install --production (with memory optimizations)"
  echo "[$(date)] This may take 5-10 minutes depending on network speed..."

  # Run npm install - disable set -e temporarily
  set +e
  npm install --production --prefer-offline --no-audit --ignore-scripts=false 2>&1 | tee /tmp/npm-install.log
  NPM_EXIT_CODE=${PIPESTATUS[0]}
  set -e

  if [ $NPM_EXIT_CODE -ne 0 ]; then
    echo "[$(date)] npm install failed with exit code $NPM_EXIT_CODE"
    echo "[$(date)] Checking error details..."
    grep -i "enoent\|spawn\|sh" /tmp/npm-install.log | tail -20 || echo "No shell-related errors found"
    echo "[$(date)] Trying with ignore-scripts as fallback..."
    
    set +e
    npm install --production --prefer-offline --no-audit --ignore-scripts 2>&1 | tee -a /tmp/npm-install.log
    NPM_EXIT_CODE=${PIPESTATUS[0]}
    set -e
    
    if [ $NPM_EXIT_CODE -ne 0 ]; then
      echo "[$(date)] ERROR: npm install failed even with --ignore-scripts"
      echo "[$(date)] Last 100 lines of npm output:"
      tail -100 /tmp/npm-install.log
      echo "[$(date)] Checking if partial node_modules exists:"
      ls -la node_modules 2>&1 | head -20 || echo "node_modules does not exist"
      exit 1
    else
      echo "[$(date)] ⚠ npm install succeeded with --ignore-scripts (some postinstall scripts were skipped)"
    fi
  fi
fi

echo "[$(date)] npm install completed successfully"

# Verify critical dependencies are installed
echo "[$(date)] Verifying dependencies installed..."
MISSING_DEPS=""
for dep in express dotenv mongoose; do
  if [ ! -d "node_modules/$dep" ]; then
    MISSING_DEPS="$MISSING_DEPS $dep"
  fi
done

if [ -n "$MISSING_DEPS" ]; then
  echo "[$(date)] ERROR: Missing critical dependencies:$MISSING_DEPS"
  echo "[$(date)] node_modules directory exists: $([ -d node_modules ] && echo 'yes' || echo 'no')"
  echo "[$(date)] node_modules contents (first 20):"
  ls -la node_modules 2>&1 | head -20 || echo "Cannot list node_modules"
  echo "[$(date)] Checking npm install log for errors:"
  grep -i "error\|failed\|missing" /tmp/npm-install.log | tail -20 || echo "No errors found in log"
  exit 1
fi

echo "[$(date)] ✓ Critical dependencies verified: express, dotenv, mongoose"
echo "[$(date)] node_modules size: $(du -sh node_modules 2>/dev/null || echo 'unknown')"

# Always rebuild to ensure latest source code changes are included
# The deployment package may include an old build, so we rebuild to be safe
echo "[$(date)] Rebuilding application to ensure latest code is used..."
echo "[$(date)] (Deployment package may include old build, so we rebuild from source)"

echo "[$(date)] Installing build dependencies (ttypescript and typescript)..."
if ! npm install ttypescript typescript --save-dev --no-save --prefer-offline --no-audit 2>&1 | tee /tmp/build-deps-install.log; then
  echo "[$(date)] ERROR: Failed to install build dependencies"
  echo "[$(date)] Build deps install log:"
  cat /tmp/build-deps-install.log
  exit 1
fi

# Verify tsconfig.json exists before building
if [ ! -f "tsconfig.json" ]; then
  echo "[$(date)] ERROR: tsconfig.json not found - cannot build application"
  echo "[$(date)] Current directory: $(pwd)"
  echo "[$(date)] Directory contents:"
  ls -la | head -20
  exit 1
fi

# Verify critical source files and directories exist before building
echo "[$(date)] Verifying source directory structure..."
MISSING_SRC_FILES=""
for file in "src/app.ts" "src/setupDatabase.ts" "src/config.ts" "src/setupServer.ts"; do
  if [ ! -f "$file" ] || [ ! -s "$file" ]; then
    MISSING_SRC_FILES="$MISSING_SRC_FILES $file"
  fi
done

for dir in "src/shared" "src/features"; do
  if [ ! -d "$dir" ]; then
    MISSING_SRC_FILES="$MISSING_SRC_FILES $dir/"
  fi
done

if [ -n "$MISSING_SRC_FILES" ]; then
  echo "[$(date)] ERROR: Missing critical source files/directories:$MISSING_SRC_FILES"
  echo "[$(date)] Current directory: $(pwd)"
  echo "[$(date)] src directory structure:"
  find src -type f -name "*.ts" | head -20 || echo "src directory is empty or missing"
  exit 1
fi

echo "[$(date)] ✓ Source directory structure verified"

echo "[$(date)] Building application (this may take 2-5 minutes)..."
set +e
npm run build 2>&1 | tee /tmp/build.log
BUILD_EXIT_CODE=${PIPESTATUS[0]}
set -e

if [ $BUILD_EXIT_CODE -ne 0 ]; then
  echo "[$(date)] ERROR: Build failed with exit code $BUILD_EXIT_CODE"
  echo "[$(date)] Build log (last 100 lines):"
  tail -100 /tmp/build.log
  exit 1
fi

# Check if build actually produced output (even if npm returned 0)
if [ ! -f "./build/src/app.js" ]; then
  echo "[$(date)] ERROR: Build command succeeded but output file not found"
  echo "[$(date)] Build log (last 100 lines):"
  tail -100 /tmp/build.log
  exit 1
fi

echo "[$(date)] ✓ Build completed successfully"

# Verify build output exists
if [ ! -f "./build/src/app.js" ]; then
  echo "[$(date)] ERROR: Build output not found at ./build/src/app.js"
  echo "[$(date)] Build directory contents:"
  ls -la build/ 2>&1 || echo "Build directory does not exist"
  echo "[$(date)] Build log (last 50 lines):"
  tail -50 /tmp/build.log
  exit 1
fi

echo "[$(date)] ✓ Build output verified: ./build/src/app.js exists"

echo "[$(date)] AfterInstall hook completed successfully"

