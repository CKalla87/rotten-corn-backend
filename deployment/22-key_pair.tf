resource "aws_key_pair" "chatapp_key_pair" {
  count      = var.ec2_key_pair_public_key != "" ? 1 : 0
  key_name   = "${var.prefix}-key-pair"
  public_key = var.ec2_key_pair_public_key

  tags = merge(
    local.common_tags,
    tomap({ "Name" = "${var.prefix}-key-pair" })
  )
}

