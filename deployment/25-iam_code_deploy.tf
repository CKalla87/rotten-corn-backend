locals {
  code_deploy_role_name = length(var.code_deploy_role_name) > 0 ? var.code_deploy_role_name : "${var.prefix}-code-deploy-role"
}

resource "aws_iam_role" "code_deploy_iam_role" {
  name = local.code_deploy_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "codedeploy.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "AWSCodeDeployRole" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSCodeDeployRole"
  role       = aws_iam_role.code_deploy_iam_role.name
}

# Attach Auto Scaling full access policy for CodeDeploy blue/green deployments
resource "aws_iam_role_policy_attachment" "AutoScalingFullAccess" {
  policy_arn = "arn:aws:iam::aws:policy/AutoScalingFullAccess"
  role       = aws_iam_role.code_deploy_iam_role.name
}

# Additional permissions for Auto Scaling and EC2 for blue/green deployments
resource "aws_iam_role_policy" "code_deploy_additional_permissions" {
  name = "${local.code_deploy_role_name}-additional-permissions"
  role = aws_iam_role.code_deploy_iam_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "autoscaling:*",
          "ec2:*",
          "iam:PassRole",
          "iam:GetRole",
          "iam:GetInstanceProfile",
          "iam:CreateInstanceProfile",
          "iam:AddRoleToInstanceProfile",
          "iam:RemoveRoleFromInstanceProfile",
          "tag:GetResources",
          "tag:TagResources",
          "sns:Publish",
          "s3:GetObject",
          "s3:GetObjectVersion"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeTargetHealth",
          "elasticloadbalancing:ModifyTargetGroupAttributes",
          "elasticloadbalancing:RegisterTargets",
          "elasticloadbalancing:DeregisterTargets"
        ]
        Resource = "*"
      }
    ]
  })
}

