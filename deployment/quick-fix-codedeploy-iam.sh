#!/bin/bash

# Quick fix: Attach CodeDeploy policy to EC2 IAM role manually
# Use this if you can't apply Terraform immediately

set -e

REGION="us-east-1"
ROLE_NAME="${1:-chatapp-server-default-ec2-role}"

echo "=========================================="
echo "Quick Fix: CodeDeploy IAM Permissions"
echo "=========================================="
echo "Role: $ROLE_NAME"
echo "Region: $REGION"
echo ""

# Check if role exists
echo "1. Checking if role exists..."
if ! aws iam get-role --role-name "$ROLE_NAME" --region "$REGION" > /dev/null 2>&1; then
  echo "❌ Error: Role '$ROLE_NAME' not found!"
  echo ""
  echo "Available roles:"
  aws iam list-roles --query 'Roles[?contains(RoleName, `ec2`) || contains(RoleName, `chatapp`)].RoleName' --output table --region "$REGION"
  exit 1
fi

echo "✓ Role found"
echo ""

# Check if policy is already attached
echo "2. Checking current attached policies..."
POLICIES=$(aws iam list-attached-role-policies --role-name "$ROLE_NAME" --region "$REGION" --query 'AttachedPolicies[].PolicyArn' --output text)

if echo "$POLICIES" | grep -q "service-role/AmazonEC2RoleforAWSCodeDeploy"; then
  echo "✓ CodeDeploy policy already attached!"
  echo ""
  echo "Current policies:"
  echo "$POLICIES" | tr '\t' '\n'
  exit 0
fi

echo "Current policies:"
echo "$POLICIES" | tr '\t' '\n' || echo "  (none)"
echo ""

# Attach the policy
echo "3. Attaching AmazonEC2RoleforAWSCodeDeploy policy..."
aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonEC2RoleforAWSCodeDeploy" \
  --region "$REGION"

if [ $? -eq 0 ]; then
  echo "✓ Policy attached successfully!"
  echo ""
  echo "4. Waiting 10 seconds for IAM propagation..."
  sleep 10
  echo "✓ Done!"
  echo ""
  echo "=========================================="
  echo "Next Steps:"
  echo "=========================================="
  echo "1. Restart CodeDeploy agent on instances:"
  echo "   ./deployment/ssh-backend.sh"
  echo "   sudo service codedeploy-agent restart"
  echo ""
  echo "2. Verify agent status:"
  echo "   sudo service codedeploy-agent status"
  echo "   sudo tail -50 /var/log/amazon/codedeploy-agent/codedeploy-agent.log"
  echo ""
  echo "3. Try your deployment again"
  echo ""
else
  echo "❌ Failed to attach policy"
  exit 1
fi

