# Fix CodeDeploy Agent "UnknownError" Issue

## Problem
CodeDeploy agent cannot receive lifecycle events:
```
Error code: UnknownError
Message: CodeDeploy agent was not able to receive the lifecycle event. 
Check the CodeDeploy agent logs on your host and make sure the agent is 
running and can connect to the CodeDeploy server.
```

## Root Cause
The EC2 instances are missing the required IAM permissions for CodeDeploy agent to communicate with AWS CodeDeploy service.

## Solution

### 1. Update IAM Role (Terraform)

The EC2 IAM role needs the `AmazonEC2RoleforAWSCodeDeploy` managed policy.

**File:** `deployment/17-iam_ec2_roles.tf`

**Change Applied:**
```terraform
# Attach AWS managed policy for CodeDeploy agent
resource "aws_iam_role_policy_attachment" "ec2_codedeploy_policy" {
  role       = aws_iam_role.ec2_iam_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2RoleforAWSCodeDeploy"
}
```

**Note:** The policy ARN includes `/service-role/` in the path.

### 2. Apply Terraform Changes

```bash
cd deployment
terraform workspace select develop  # or your workspace
terraform plan
terraform apply
```

This will:
- Attach the `AmazonEC2RoleforAWSCodeDeploy` policy to the EC2 IAM role
- Existing instances will automatically get the new permissions (no restart needed)

### 3. Verify Agent Status

Run the diagnostic script:
```bash
./deployment/fix-codedeploy-agent.sh [INSTANCE_ID] [BACKEND_IP]
```

Or manually check:
```bash
./deployment/ssh-backend.sh
sudo service codedeploy-agent status
sudo tail -50 /var/log/amazon/codedeploy-agent/codedeploy-agent.log
```

### 4. Restart Agent (if needed)

If the agent is running but still having issues:
```bash
./deployment/ssh-backend.sh
sudo service codedeploy-agent restart
sudo service codedeploy-agent status
```

### 5. Reinstall Agent (if still failing)

If the agent is completely broken:
```bash
./deployment/fix-codedeploy-agent.sh
```

This script will:
- Check agent status
- Reinstall the agent if needed
- Restart the service
- Show diagnostic information

## What the Policy Provides

The `AmazonEC2RoleforAWSCodeDeploy` policy grants:
- `s3:GetObject` - Download deployment artifacts from S3
- `s3:GetObjectVersion` - Access specific versions of artifacts
- `s3:ListBucket` - List S3 buckets
- Other CodeDeploy-specific permissions

## Verification

After applying the fix:

1. **Check IAM Role:**
   ```bash
   aws iam list-attached-role-policies --role-name chatapp-server-default-ec2-role
   ```
   Should show `arn:aws:iam::aws:policy/service-role/AmazonEC2RoleforAWSCodeDeploy`

2. **Check Agent Logs:**
   ```bash
   ./deployment/ssh-backend.sh
   sudo tail -50 /var/log/amazon/codedeploy-agent/codedeploy-agent.log
   ```
   Should not show permission errors

3. **Test Deployment:**
   Create a new deployment and verify it can reach the instances.

## Alternative: Manual IAM Update

If you can't apply Terraform immediately:

1. Go to IAM Console → Roles
2. Find your EC2 role (e.g., `chatapp-server-default-ec2-role`)
3. Attach policy: `service-role/AmazonEC2RoleforAWSCodeDeploy` (ARN: `arn:aws:iam::aws:policy/service-role/AmazonEC2RoleforAWSCodeDeploy`)
4. Wait 1-2 minutes for propagation
5. Restart CodeDeploy agent on instances:
   ```bash
   ./deployment/ssh-backend.sh
   sudo service codedeploy-agent restart
   ```

## Notes

- **No instance restart needed** - IAM role changes take effect immediately
- **All instances** in the ASG will automatically get the new permissions
- The fix is **permanent** once Terraform is applied

