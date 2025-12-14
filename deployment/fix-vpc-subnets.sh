#!/bin/bash
set -e

echo "=========================================="
echo "VPC and Subnet Configuration Fix Script"
echo "=========================================="
echo ""

cd "$(dirname "$0")"

# Get subnet IDs from Terraform state
echo "1. Checking current subnet configuration..."
PUBLIC_SUBNET_A=$(terraform state show aws_subnet.public_subnet_a 2>/dev/null | grep "id.*=" | awk '{print $3}' | tr -d '"')
PUBLIC_SUBNET_B=$(terraform state show aws_subnet.public_subnet_b 2>/dev/null | grep "id.*=" | awk '{print $3}' | tr -d '"')
PRIVATE_SUBNET_A=$(terraform state show aws_subnet.private_subnet_a 2>/dev/null | grep "id.*=" | awk '{print $3}' | tr -d '"')
PRIVATE_SUBNET_B=$(terraform state show aws_subnet.private_subnet_b 2>/dev/null | grep "id.*=" | awk '{print $3}' | tr -d '"')

echo "   Public Subnet A:  $PUBLIC_SUBNET_A"
echo "   Public Subnet B:  $PUBLIC_SUBNET_B"
echo "   Private Subnet A: $PRIVATE_SUBNET_A"
echo "   Private Subnet B: $PRIVATE_SUBNET_B"
echo ""

# Get ALB subnet configuration
echo "2. Checking ALB subnet configuration..."
ALB_SUBNETS=$(terraform state show aws_alb.application_load_balancer 2>/dev/null | grep -A 5 "subnets" | grep "subnet-" | awk '{print $1}' | tr -d '"' | tr -d ',' | sort)

echo "   ALB Subnets:"
echo "$ALB_SUBNETS" | while read subnet; do
  if [ "$subnet" = "$PUBLIC_SUBNET_A" ] || [ "$subnet" = "$PUBLIC_SUBNET_B" ]; then
    echo "     ✓ $subnet (Public - CORRECT)"
  else
    echo "     ✗ $subnet (WRONG - Should be public)"
  fi
done

EXPECTED_ALB_SUBNETS=$(echo -e "$PUBLIC_SUBNET_A\n$PUBLIC_SUBNET_B" | sort)
if [ "$ALB_SUBNETS" != "$EXPECTED_ALB_SUBNETS" ]; then
  echo "   ⚠️  ALB is NOT in the correct public subnets!"
  ALB_NEEDS_FIX=true
else
  echo "   ✅ ALB is correctly configured in public subnets"
  ALB_NEEDS_FIX=false
fi
echo ""

# Get ASG subnet configuration
echo "3. Checking ASG subnet configuration..."
ASG_SUBNETS=$(terraform state show aws_autoscaling_group.ec2_autoscaling_group 2>/dev/null | grep -A 5 "vpc_zone_identifier" | grep "subnet-" | awk '{print $1}' | tr -d '"' | tr -d ',' | sort)

echo "   ASG Subnets:"
echo "$ASG_SUBNETS" | while read subnet; do
  if [ "$subnet" = "$PRIVATE_SUBNET_A" ] || [ "$subnet" = "$PRIVATE_SUBNET_B" ]; then
    echo "     ✓ $subnet (Private - CORRECT)"
  else
    echo "     ✗ $subnet (WRONG - Should be private)"
  fi
done

EXPECTED_ASG_SUBNETS=$(echo -e "$PRIVATE_SUBNET_A\n$PRIVATE_SUBNET_B" | sort)
if [ "$ASG_SUBNETS" != "$EXPECTED_ASG_SUBNETS" ]; then
  echo "   ⚠️  ASG is NOT in the correct private subnets!"
  ASG_NEEDS_FIX=true
else
  echo "   ✅ ASG is correctly configured in private subnets"
  ASG_NEEDS_FIX=false
fi
echo ""

# Check if fixes are needed
if [ "$ALB_NEEDS_FIX" = true ] || [ "$ASG_NEEDS_FIX" = true ]; then
  echo "=========================================="
  echo "FIXES NEEDED"
  echo "=========================================="
  echo ""
  
  if [ "$ALB_NEEDS_FIX" = true ]; then
    echo "⚠️  ALB needs to be moved to public subnets"
    echo "   Note: ALBs cannot have subnets changed in-place."
    echo "   You'll need to recreate the ALB by:"
    echo "   1. Running: terraform taint aws_alb.application_load_balancer"
    echo "   2. Running: terraform apply"
    echo "   OR use: terraform apply -replace=aws_alb.application_load_balancer"
    echo ""
  fi
  
  if [ "$ASG_NEEDS_FIX" = true ]; then
    echo "⚠️  ASG needs to be moved to private subnets"
    echo "   This can be fixed by running:"
    echo "   terraform apply"
    echo "   (ASG subnet changes can be updated in-place)"
    echo ""
  fi
  
  echo "Would you like to apply fixes now? (y/n)"
  read -r response
  if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    if [ "$ALB_NEEDS_FIX" = true ]; then
      echo "Recreating ALB..."
      terraform apply -replace=aws_alb.application_load_balancer -auto-approve
    fi
    
    if [ "$ASG_NEEDS_FIX" = true ]; then
      echo "Updating ASG..."
      terraform apply -auto-approve
    fi
    
    echo ""
    echo "✅ Fixes applied! Please verify the configuration above."
  else
    echo "Fix cancelled. Run this script again when ready."
  fi
else
  echo "=========================================="
  echo "✅ CONFIGURATION IS CORRECT"
  echo "=========================================="
  echo ""
  echo "The VPC and subnet configuration is correct:"
  echo "  - ALB is in PUBLIC subnets (accessible from internet)"
  echo "  - ASG is in PRIVATE subnets (protected behind ALB)"
  echo ""
  echo "If you're still having issues testing signup/signin, check:"
  echo "  1. Security groups allow traffic from ALB to ASG (port 5000)"
  echo "  2. ALB target group health checks are passing"
  echo "  3. Route53 DNS is pointing to the ALB"
  echo "  4. EC2 instances are running and healthy in the ASG"
  echo "  5. Application is listening on port 5000"
  echo ""
fi


