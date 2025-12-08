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
sudo rm -rf env-file.zip .env .env.production

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
    sudo cp .env.production .env
    echo "[$(date)] Copied .env.production to .env"
  elif [ -f .env ]; then
    echo "[$(date)] .env file already exists"
  else
    echo "[$(date)] ERROR: No .env or .env.production file found after extraction!"
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

# Stop any existing PM2 processes
if ! command -v npm >/dev/null 2>&1; then
  NODE_VERSION="16.20.2"
  NODE_DIST="node-v${NODE_VERSION}-linux-x64"
  NODE_INSTALL_DIR="/opt/nodejs"

  echo "[$(date)] Installing Node.js ${NODE_VERSION} from official tarball"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.tar.xz" -o /tmp/node.tar.xz
  sudo mkdir -p "${NODE_INSTALL_DIR}"
  sudo tar -xJf /tmp/node.tar.xz -C "${NODE_INSTALL_DIR}"
  for target in /usr/local/bin /usr/bin; do
    sudo ln -sf "${NODE_INSTALL_DIR}/${NODE_DIST}/bin/node" "${target}/node"
    sudo ln -sf "${NODE_INSTALL_DIR}/${NODE_DIST}/bin/npm" "${target}/npm"
    sudo ln -sf "${NODE_INSTALL_DIR}/${NODE_DIST}/bin/npx" "${target}/npx"
  done
  export PATH="/usr/local/bin:/usr/bin:$PATH"
  rm -f /tmp/node.tar.xz
fi

echo "[$(date)] Ensuring PM2 is installed"
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2 --unsafe-perm
fi

echo "[$(date)] Stopping existing PM2 processes"
sudo pm2 delete all || true

# Install dependencies
echo "[$(date)] Installing npm dependencies"
if ! sudo npm install; then
  echo "[$(date)] npm install failed, trying with --legacy-peer-deps"
  sudo npm install --legacy-peer-deps || {
    echo "[$(date)] ERROR: npm install failed completely"
    exit 1
  }
fi

echo "[$(date)] AfterInstall hook completed successfully"

