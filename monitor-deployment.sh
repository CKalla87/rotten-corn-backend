#!/bin/bash

# Monitor CodeDeploy deployment status

DEPLOYMENT_ID="${1:-d-06BH7ZLNG}"
REGION="us-east-1"

echo "=========================================="
echo "Monitoring Deployment: $DEPLOYMENT_ID"
echo "=========================================="
echo ""

while true; do
  STATUS=$(aws deploy get-deployment \
    --deployment-id "$DEPLOYMENT_ID" \
    --region "$REGION" \
    --query 'deploymentInfo.status' \
    --output text 2>/dev/null)

  if [ -z "$STATUS" ]; then
    echo "❌ Error: Could not retrieve deployment status"
    break
  fi

  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$TIMESTAMP] Status: $STATUS"

  case "$STATUS" in
    "Succeeded")
      echo ""
      echo "✅ Deployment completed successfully!"
      echo ""
      aws deploy get-deployment \
        --deployment-id "$DEPLOYMENT_ID" \
        --region "$REGION" \
        --query '{Status:deploymentInfo.status,CompleteTime:deploymentInfo.completeTime,Instances:deploymentInfo.instanceTerminationWaitTimeStarted}' \
        --output json
      break
      ;;
    "Failed"|"Stopped")
      echo ""
      echo "❌ Deployment failed or stopped!"
      echo ""
      aws deploy get-deployment \
        --deployment-id "$DEPLOYMENT_ID" \
        --region "$REGION" \
        --query '{Status:deploymentInfo.status,ErrorMessage:deploymentInfo.errorInformation.message,ErrorCode:deploymentInfo.errorInformation.code}' \
        --output json
      echo ""
      echo "Check instance logs:"
      echo "  ./deployment/get-logs.sh codedeploy 100"
      break
      ;;
    "Created"|"Queued"|"InProgress"|"Ready")
      echo "  Waiting for deployment to progress..."
      sleep 5
      ;;
    *)
      echo "  Unknown status: $STATUS"
      sleep 5
      ;;
  esac
done

