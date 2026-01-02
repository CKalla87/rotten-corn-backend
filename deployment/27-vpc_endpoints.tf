# VPC Endpoints to reduce NAT Gateway data transfer costs
# These endpoints allow private connectivity to AWS services without going through NAT Gateway

# S3 Gateway Endpoint (FREE - no data transfer charges)
# This can save $50-150/month if you're transferring data to/from S3
resource "aws_vpc_endpoint" "s3_endpoint" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"

  route_table_ids = [
    aws_route_table.private_route_table.id
  ]

  tags = merge(
    local.common_tags,
    tomap({ "Name" = "${local.prefix}-s3-endpoint" })
  )
}

# DynamoDB Gateway Endpoint (FREE - no data transfer charges)
# Uncomment if you're using DynamoDB
# resource "aws_vpc_endpoint" "dynamodb_endpoint" {
#   vpc_id            = aws_vpc.main.id
#   service_name      = "com.amazonaws.${var.aws_region}.dynamodb"
#   vpc_endpoint_type = "Gateway"
#
#   route_table_ids = [
#     aws_route_table.private_route_table.id
#   ]
#
#   tags = merge(
#     local.common_tags,
#     tomap({ "Name" = "${local.prefix}-dynamodb-endpoint" })
#   )
# }

# Optional: SQS Interface Endpoint (if using SQS)
# Small hourly fee (~$7/month) but no data transfer charges
# Uncomment if you're using SQS heavily
# resource "aws_vpc_endpoint" "sqs_endpoint" {
#   vpc_id              = aws_vpc.main.id
#   service_name        = "com.amazonaws.${var.aws_region}.sqs"
#   vpc_endpoint_type   = "Interface"
#   subnet_ids          = [aws_subnet.private_subnet_a.id, aws_subnet.private_subnet_b.id]
#   security_group_ids  = [aws_security_group.vpc_endpoint_sg.id]
#   private_dns_enabled = true
#
#   tags = merge(
#     local.common_tags,
#     tomap({ "Name" = "${local.prefix}-sqs-endpoint" })
#   )
# }

# Optional: SNS Interface Endpoint (if using SNS)
# Small hourly fee (~$7/month) but no data transfer charges
# resource "aws_vpc_endpoint" "sns_endpoint" {
#   vpc_id              = aws_vpc.main.id
#   service_name        = "com.amazonaws.${var.aws_region}.sns"
#   vpc_endpoint_type   = "Interface"
#   subnet_ids          = [aws_subnet.private_subnet_a.id, aws_subnet.private_subnet_b.id]
#   security_group_ids  = [aws_security_group.vpc_endpoint_sg.id]
#   private_dns_enabled = true
#
#   tags = merge(
#     local.common_tags,
#     tomap({ "Name" = "${local.prefix}-sns-endpoint" })
#   )
# }




