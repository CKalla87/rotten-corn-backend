#!/bin/bash

# Get logs from the latest failed deployment

REGION="us-east-1"
APP_NAME="chatapp-server-default-app"
DG_NAME="chatapp-server-default-group"

echo "=== Getting Latest Deployment ==="
LATEST_DEPLOYMENT=$(aws deploy list-deployments \
  --application-name $APP_NAME \
  --deployment-group-name $DG_NAME \
  --region $REGION \
  --max-items 1 \
  --query 'deployments[0]' \
  --output text)

if [ "$LATEST_DEPLOYMENT" == "None" ] || [ -z "$LATEST_DEPLOYMENT" ]; then
  echo "No deployments found"
  exit 1
fi

echo "Deployment ID: $LATEST_DEPLOYMENT"
echo ""

echo "=== Deployment Status ==="
aws deploy get-deployment \
  --deployment-id $LATEST_DEPLOYMENT \
  --region $REGION \
  --query '{Status:deploymentInfo.status,ErrorInformation:deploymentInfo.errorInformation,CreateTime:deploymentInfo.createTime}' \
  --output json

echo ""
echo "=== Getting Instance IDs ==="
INSTANCE_IDS=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names chatapp-server-default-ASG \
  --region $REGION \
  --query 'AutoScalingGroups[0].Instances[*].InstanceId' \
  --output text)

echo "Instances: $INSTANCE_IDS"
echo ""

echo "=== Instance Deployment Status ==="
for instance in $INSTANCE_IDS; do
  echo "--- Instance: $instance ---"
  aws deploy get-deployment-instance \
    --deployment-id $LATEST_DEPLOYMENT \
    --instance-id $instance \
    --region $REGION \
    --query 'instanceSummary.{Status:status,LifecycleEvents:lifecycleEvents}' \
    --output json 2>&1 | head -50
  echo ""
done

echo ""
echo "=== To check logs on instances, SSH in and run: ==="
echo "  sudo tail -100 /opt/codedeploy-agent/deployment-root/deployment-logs/codedeploy-agent-deployments.log"
echo "  sudo tail -100 /var/log/aws/codedeploy-agent/codedeploy-agent.log"
echo "  sudo pm2 logs"
echo "  sudo journalctl -u codedeploy-agent -n 100"

