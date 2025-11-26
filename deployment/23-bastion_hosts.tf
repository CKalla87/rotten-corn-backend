resource "aws_instance" "bastion_host" {
  ami                         = data.aws_ami.ec2_ami.id
  instance_type               = var.bastion_host_type
  vpc_security_group_ids      = [aws_security_group.bastion_host_sg.id]
  subnet_id                   = aws_subnet.public_subnet_a.id
  key_name                    = var.ec2_key_pair_public_key != "" ? aws_key_pair.chatapp_key_pair[0].key_name : "chatappKeyPair"
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.ec2_instance_profile.name

  tags = merge(
    local.common_tags,
    tomap({ "Name" = "${local.prefix}-bastion-host" })
  )
}

