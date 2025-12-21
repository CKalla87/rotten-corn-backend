#!/bin/bash

# Create CodeDeploy deployment
# Note: Using deployment config that matches the deployment group configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

aws deploy create-deployment \
  --region us-east-1 \
  --application-name chatapp-server-default-app \
  --deployment-config-name CodeDeployDefault.AllAtOnce \
  --deployment-group-name chatapp-server-default-group \
  --target-instances file://${SCRIPT_DIR}/empty-target-instances.json \
  --file-exists-behavior "OVERWRITE" \
  --s3-location bucket=chatapp-server-default-app-602951639614,bundleType=zip,key=chatapp.zip

