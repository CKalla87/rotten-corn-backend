#!/bin/bash

# Check CodeDeploy deployment status
APPLICATION_NAME="chatapp-server-default-app"
DEPLOYMENT_GROUP="chatapp-server-default-group"
REGION="us-east-1"

echo "=== Recent Deployments ==="
aws deploy list-deployments \
  --application-name $APPLICATION_NAME \
  --deployment-group-name $DEPLOYMENT_GROUP \
  --region $REGION \
  --max-items 5 \
  --query 'deployments[0:5]' \
  --output table

echo ""
echo "=== Latest Deployment Details ==="
LATEST_DEPLOYMENT=$(aws deploy list-deployments \
  --application-name $APPLICATION_NAME \
  --deployment-group-name $DEPLOYMENT_GROUP \
  --region $REGION \
  --max-items 1 \
  --query 'deployments[0]' \
  --output text)

if [ "$LATEST_DEPLOYMENT" != "None" ] && [ -n "$LATEST_DEPLOYMENT" ]; then
  echo "Deployment ID: $LATEST_DEPLOYMENT"
  echo ""
  aws deploy get-deployment \
    --deployment-id $LATEST_DEPLOYMENT \
    --region $REGION \
    --query '{Status:deploymentInfo.status,StatusMessage:deploymentInfo.statusMessage,ErrorInformation:deploymentInfo.errorInformation,CreateTime:deploymentInfo.createTime}' \
    --output json
else
  echo "No deployments found"
fi

