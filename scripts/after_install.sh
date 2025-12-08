#!/bin/bash
set -e  # Exit on any error

# CodeDeploy AfterInstall hook
# This script runs after the application files are extracted
# The current working directory is the deployment archive location

DEPLOYMENT_DIR="/home/ec2-user/chatty-backend"
mkdir -p "$DEPLOYMENT_DIR"

echo "[$(date)] Using deployment directory $DEPLOYMENT_DIR"
if [ ! -d "$DEPLOYMENT_DIR" ]; then
  echo "[$(date)] ERROR: $DEPLOYMENT_DIR does not exist after copy phase"
  exit 1
fi

cd "$DEPLOYMENT_DIR"
echo "[$(date)] Changed to $DEPLOYMENT_DIR"

# Clean up old environment files
echo "[$(date)] Cleaning up old environment files"
rm -rf env-file.zip .env .env.production

# Download and extract environment files
ENV_BUCKET="chattapplication1-env-files"
# Determine environment prefix based on deployment group or default to staging
ENV_PREFIX="${ENV_PREFIX:-staging}"

echo "[$(date)] Downloading environment files from S3 bucket ${ENV_BUCKET}/${ENV_PREFIX}"
if ! aws s3 sync "s3://${ENV_BUCKET}/${ENV_PREFIX}" . 2>&1; then
  echo "[$(date)] ERROR: Failed to sync from S3 - this will cause app startup to fail!"
  echo "[$(date)] Attempting to continue, but app may crash if .env is missing"
fi

if [ -f env-file.zip ]; then
  echo "[$(date)] Extracting environment files"
  unzip -o env-file.zip
  if [ -f .env.production ]; then
    cp .env.production .env
    echo "[$(date)] Copied .env.production to .env"
  elif [ -f .env.develop ]; then
    cp .env.develop .env
    echo "[$(date)] Copied .env.develop to .env"
  elif [ -f .env ]; then
    echo "[$(date)] .env file already exists"
  else
    echo "[$(date)] ERROR: No .env, .env.production, or .env.develop file found after extraction!"
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
export PATH="/usr/local/bin:/usr/bin:/opt/nodejs/node-v16.20.2-linux-x64/bin:$PATH"

# Stop any existing PM2 processes
if ! command -v npm >/dev/null 2>&1; then
  NODE_VERSION="16.20.2"
  NODE_DIST="node-v${NODE_VERSION}-linux-x64"
  NODE_INSTALL_DIR="/opt/nodejs"

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
echo "[$(date)] Node version: $(node --version)"
echo "[$(date)] NPM version: $(npm --version)"
echo "[$(date)] Checking package.json..."
cat package.json | head -10

# Clean install to ensure fresh dependencies
rm -rf node_modules package-lock.json 2>/dev/null || true

# Run npm install with verbose output
echo "[$(date)] Starting npm install (this may take several minutes)..."
if ! npm install --production 2>&1 | tee /tmp/npm-install.log; then
  echo "[$(date)] npm install failed, trying with --legacy-peer-deps"
  if ! npm install --production --legacy-peer-deps 2>&1 | tee -a /tmp/npm-install.log; then
    echo "[$(date)] ERROR: npm install failed completely"
    echo "[$(date)] Last 100 lines of npm install output:"
    tail -100 /tmp/npm-install.log
    echo "[$(date)] Checking if node_modules exists:"
    ls -la node_modules 2>&1 | head -20 || echo "node_modules does not exist"
    exit 1
  fi
fi

# Verify critical dependencies are installed
echo "[$(date)] Verifying dependencies installed..."
MISSING_DEPS=""
for dep in express passport dotenv; do
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

echo "[$(date)] ✓ Critical dependencies verified: express, passport, dotenv"
echo "[$(date)] node_modules size: $(du -sh node_modules 2>/dev/null || echo 'unknown')"

echo "[$(date)] AfterInstall hook completed successfully"

