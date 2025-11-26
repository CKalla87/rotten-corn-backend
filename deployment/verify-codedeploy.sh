#!/bin/bash

echo "=== Checking CodeDeploy Application ==="
aws deploy list-applications --region us-east-1 | grep -i "chatapp-server"

echo ""
echo "=== Checking CodeDeploy Deployment Groups ==="
aws deploy list-deployment-groups --application-name chatapp-server-default-app --region us-east-1 2>/dev/null || echo "Application not found or no deployment groups"

echo ""
echo "=== Checking IAM Role ==="
aws iam get-role --role-name chatapp-server-code-deploy-role 2>/dev/null && echo "✓ IAM Role exists" || echo "✗ IAM Role not found"

echo ""
echo "=== Checking S3 Bucket ==="
aws s3 ls | grep -i "chatapp-server.*app"

