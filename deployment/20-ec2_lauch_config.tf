resource "aws_launch_template" "asg_launch_template" {
  name_prefix   = "${local.prefix}-launch-template-"
  image_id      = data.aws_ami.ec2_ami.id
  instance_type = var.ec2_instance_type
  key_name      = var.ec2_key_pair_public_key != "" ? aws_key_pair.chatapp_key_pair[0].key_name : "chatappKeyPair"

  update_default_version = true

  vpc_security_group_ids = [aws_security_group.autoscaling_group_sg.id]

  iam_instance_profile {
    name = aws_iam_instance_profile.ec2_instance_profile.name
  }

  user_data = filebase64("${path.module}/userdata/user-data.sh")

  tag_specifications {
    resource_type = "instance"
    tags = merge(
      local.common_tags,
      tomap({ "Name" = "${local.prefix}-asg-instance" })
    )
  }

  lifecycle {
    create_before_destroy = true
  }
}

