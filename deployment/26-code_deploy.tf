# IN-PLACE DEPLOYMENT (FASTEST & COST-EFFECTIVE)
# Deploys directly to existing instances - no new instances created
# WARNING: Brief downtime possible during deployment

resource "aws_codedeploy_app" "code_deploy_app" {
  name             = "${local.prefix}-app"
  compute_platform = "Server"
}

resource "aws_codedeploy_deployment_group" "code_deploy_app_group" {
  app_name              = aws_codedeploy_app.code_deploy_app.name
  deployment_group_name = "${local.prefix}-group"
  service_role_arn      = aws_iam_role.code_deploy_iam_role.arn

  autoscaling_groups = [aws_autoscaling_group.ec2_autoscaling_group.name]

  ec2_tag_filter {
    key   = "Type"
    type  = "KEY_AND_VALUE"
    value = "Backend-${terraform.workspace}"
  }

  # Use OneAtATime for safer in-place (deploys to one instance at a time)
  # This ensures at least one instance is always serving traffic
  deployment_config_name = "CodeDeployDefault.OneAtATime"

  # IN-PLACE deployment (no blue/green - no new instances created)
  deployment_style {
    deployment_option = "WITHOUT_TRAFFIC_CONTROL"
    deployment_type   = "IN_PLACE"
  }

  # No load_balancer_info needed for in-place
  # No blue_green_deployment_config needed

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE"]
  }

  provisioner "local-exec" {
    command    = file("./userdata/delete-asg.sh")
    when       = destroy
    on_failure = continue

    environment = {
      ENV_TYPE = "Backend-${terraform.workspace}"
    }
  }
}

