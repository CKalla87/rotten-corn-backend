locals {
  ec2_role_name         = length(var.ec2_iam_role_name) > 0 ? var.ec2_iam_role_name : "${var.prefix}-ec2-role"
  ec2_role_policy_name  = length(var.ec2_iam_role_policy_name) > 0 ? var.ec2_iam_role_policy_name : "${var.prefix}-ec2-role-policy"
  ec2_instance_profiler = length(var.ec2_instance_profile_name) > 0 ? var.ec2_instance_profile_name : "${var.prefix}-ec2-instance-profile"
}

resource "aws_iam_role" "ec2_iam_role" {
  name = local.ec2_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = ["ec2.amazonaws.com", "application-autoscaling.amazonaws.com"]
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "ec2_iam_role_policy" {
  name   = local.ec2_role_policy_name
  role   = aws_iam_role.ec2_iam_role.id
  policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "ec2-instance-connect:SendSSHPublicKey",
        "s3:*",
        "elasticloadbalancing:*",
        "cloudwatch:*",
        "logs:*",
        "autoscaling:*",
        "sns:Publish",
        "tag:GetResources"
      ],
      "Resource": "*"
    }
  ]
}
EOF
}

# Attach AWS managed policy for CodeDeploy agent
resource "aws_iam_role_policy_attachment" "ec2_codedeploy_policy" {
  role       = aws_iam_role.ec2_iam_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2RoleforAWSCodeDeploy"
}

resource "aws_iam_instance_profile" "ec2_instance_profile" {
  name = local.ec2_instance_profiler
  role = aws_iam_role.ec2_iam_role.name
}

