# Multi-Environment Terraform Guide

Use this checklist to spin up *separate* stacks for **staging** and **production** while reusing the same Terraform modules that currently power `develop`.

---

## 1. Create environment-specific tfvars

Copy the template below into two files: `staging.tfvars` and `production.tfvars` (keep them in the `deployment/` folder and **never commit the real secrets**).

```hcl
# staging.tfvars / production.tfvars
prefix                   = "chatapp-staging"          # or chatapp-production
project                  = "chatapp-staging"          # used in resource tags
main_api_server_domain   = "api.staging.example.com"  # DNS record pointed at the ALB
dev_api_server_domain    = "api.staging.example.com"
bastion_host_cidr        = "YOUR.PUBLIC.IP/32"
ec2_key_pair_public_key  = "ssh-ed25519 AAAA... rotten-corn-key"
```

- Generate the public key from your new PEM:  
  `ssh-keygen -y -f ~/.ssh/rotten-corn-key.pem`
- Use different `prefix` / `project` values per environment so resource names do not collide.

## 2. Apply Terraform per environment

From the `deployment/` directory run:

```bash
# Staging
terraform init
terraform workspace new staging     # only once
terraform workspace select staging
terraform apply -var-file=staging.tfvars

# Production
terraform workspace new production  # only once
terraform workspace select production
terraform apply -var-file=production.tfvars
```

Each workspace keeps its own state file, so the staging apply will create an entirely separate VPC, ALB, ASG, bastion host, CodeDeploy app/group, etc.

## 3. Record the outputs

After each apply grab the values you’ll need later (either from `terraform output` or the AWS console):

- Bastion public IP and private subnet address range.
- CodeDeploy application & deployment group names.
- S3 bucket name created for artifacts (if the module created one), or whichever bucket you plan to use.
- Auto Scaling group name (useful when inspecting instances).

## 4. Wire up GitHub environments

For each GitHub environment (`develop`, `staging`, `production`) set the secrets to the values produced by that environment’s Terraform apply:

| Secret | Example value |
| ------ | ------------- |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM user/role scoped to that environment |
| `AWS_REGION` | `us-east-1` |
| `S3_BUCKET` | e.g. `chatapp-staging-artifacts` |
| `CODEDEPLOY_APP` | e.g. `chatapp-staging-app` |
| `CODEDEPLOY_GROUP` | e.g. `chatapp-staging-group` |
| `DATABASE_URL` | Mongo URI for that environment |
| `SLACK_WEBHOOK_URL` | Slack channel for that environment |

The GitHub Actions workflow already uploads artifacts to different prefixes (`artifacts/staging/...`, `artifacts/production/...`), so only the bucket + deploy group secrets need to change per environment.

## 5. Validate

1. Push to `staging` – verify the workflow deploys to the staging CodeDeploy group and the new ASG instances register behind the staging ALB.
2. Push to `main` – confirm production deploy uses the production resources.
3. Use the new PEM (`~/.ssh/rotten-corn-key.pem`) to reach the bastion host per environment:
   ```bash
   ssh -i ~/.ssh/rotten-corn-key.pem ec2-user@<bastion-public-ip>
   ```

---

### Notes

- If you prefer separate S3 buckets per environment, declare them in Terraform and set `S3_BUCKET` accordingly. Otherwise, a single bucket with per-env prefixes works fine.
- Keep the `terraform.tfvars` file for local/dev usage only; store staging/prod secrets in the `staging.tfvars` / `production.tfvars` files outside of version control.
- Any time you rotate the SSH key, update the `ec2_key_pair_public_key` entry in each tfvars file and re-run `terraform apply` so new instances get the updated key pair automatically.

