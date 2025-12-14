#!/bin/bash

# Clean up the extra instance from old ASG

set -e

REGION="us-east-1"
EXTRA_INSTANCE_ID="i-014530d9fa17b8190"
OLD_ASG="chatapp-server-ASG"
CURRENT_ASG="chatapp-server-default-ASG"

echo "=========================================="
echo "Cleaning Up Extra Instance"
echo "=========================================="
echo "Extra Instance: $EXTRA_INSTANCE_ID"
echo "Old ASG: $OLD_ASG"
echo "Current ASG: $CURRENT_ASG"
echo ""

# Check if instance exists
echo "1. Checking instance status..."
INSTANCE_STATE=$(aws ec2 describe-instances \
  --instance-ids "$EXTRA_INSTANCE_ID" \
  --region "$REGION" \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text 2>/dev/null || echo "not-found")

if [ "$INSTANCE_STATE" = "not-found" ]; then
  echo "✓ Instance not found (may have been deleted already)"
  exit 0
fi

echo "   Instance State: $INSTANCE_STATE"
echo ""

# Check if it's in an ASG
echo "2. Checking if instance is in an ASG..."
ASG_NAME=$(aws autoscaling describe-auto-scaling-instances \
  --instance-ids "$EXTRA_INSTANCE_ID" \
  --region "$REGION" \
  --query 'AutoScalingInstances[0].AutoScalingGroupName' \
  --output text 2>/dev/null || echo "none")

if [ "$ASG_NAME" != "none" ] && [ -n "$ASG_NAME" ]; then
  echo "   Instance is in ASG: $ASG_NAME"
  echo ""

  # Update min_size to 0 first, then set desired capacity to 0
  echo "3. Updating ASG min_size to 0..."
  aws autoscaling update-auto-scaling-group \
    --auto-scaling-group-name "$ASG_NAME" \
    --min-size 0 \
    --region "$REGION"

  echo "   ✓ Min size updated"
  echo "   Waiting 5 seconds..."
  sleep 5

  echo "4. Setting ASG desired capacity to 0..."
  aws autoscaling set-desired-capacity \
    --auto-scaling-group-name "$ASG_NAME" \
    --desired-capacity 0 \
    --region "$REGION" \
    --no-honor-cooldown

  echo "   ✓ ASG desired capacity set to 0"
  echo "   Waiting 15 seconds for ASG to process..."
  sleep 15

  # Check if instance is still in ASG or was terminated
  ASG_STATE=$(aws autoscaling describe-auto-scaling-instances \
    --instance-ids "$EXTRA_INSTANCE_ID" \
    --region "$REGION" \
    --query 'AutoScalingInstances[0].LifecycleState' \
    --output text 2>/dev/null || echo "none")

  if [ "$ASG_STATE" = "none" ] || [ "$ASG_STATE" = "Terminating" ]; then
    echo "   ✓ Instance is being terminated by ASG"
    echo "   Waiting for termination..."
    for i in {1..30}; do
      STATE=$(aws ec2 describe-instances \
        --instance-ids "$EXTRA_INSTANCE_ID" \
        --region "$REGION" \
        --query 'Reservations[0].Instances[0].State.Name' \
        --output text 2>/dev/null || echo "terminated")

      if [ "$STATE" = "terminated" ]; then
        echo "   ✓ Instance terminated by ASG"
        exit 0
      fi
      sleep 5
    done
  fi
else
  echo "   Instance is not in an ASG (standalone)"
  echo ""
fi

# Terminate the instance (if not already terminated by ASG)
echo "5. Terminating instance..."
aws ec2 terminate-instances \
  --instance-ids "$EXTRA_INSTANCE_ID" \
  --region "$REGION" > /dev/null

echo "   ✓ Termination request sent"
echo ""

# Wait for termination
echo "6. Waiting for instance to terminate..."
for i in {1..30}; do
  STATE=$(aws ec2 describe-instances \
    --instance-ids "$EXTRA_INSTANCE_ID" \
    --region "$REGION" \
    --query 'Reservations[0].Instances[0].State.Name' \
    --output text 2>/dev/null || echo "terminated")

  if [ "$STATE" = "terminated" ]; then
    echo "   ✓ Instance terminated"
    break
  fi

  echo "   Waiting... ($i/30) - Current state: $STATE"
  sleep 5
done

echo ""
echo "=========================================="
echo "Cleanup Complete"
echo "=========================================="
echo ""
echo "Verifying only 1 instance remains..."
aws ec2 describe-instances \
  --region "$REGION" \
  --filters "Name=tag:Type,Values=Backend-default" "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].InstanceId' \
  --output text | wc -w | xargs echo "Running instances:"

