# rotten-corn-backend
This is the api for The Rotten Corn Horror App

## CI/CD pipeline

> Deployment triggered to fix production instances after cost optimization (January 2026)  
> Re-deploying after fixing infrastructure configuration and replacing instances

Pushes to `develop`, `staging`, and `main` now trigger the GitHub Actions workflow at `.github/workflows/ci-cd.yml`.

### Stages
- **Quality gate** – installs dependencies, runs `npm run lint:check`, executes the Jest suite, and builds the TypeScript output before any deployment begins.
- **AWS deployment** – the packaged artifact (`chatapp.zip`) is uploaded to the environment-specific S3 bucket and CodeDeploy deployment group.
- **Slack notification** – the final job posts to Slack using the block template from `notify.txt`, summarizing branch, author, quality/deploy status, and linking back to the workflow run.

### GitHub environments & secrets

Create GitHub environments named `develop`, `staging`, and `production`, then add the following secrets (values can differ per environment):

| Secret | Description |
| --- | --- |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM user/role credentials with S3 + CodeDeploy permissions. |
| `AWS_REGION` | AWS region that hosts the stacks. |
| `S3_BUCKET` | Bucket receiving `chatapp.zip` for that environment. |
| `CODEDEPLOY_APP` | CodeDeploy application name. |
| `CODEDEPLOY_GROUP` | CodeDeploy deployment group. |
| `SLACK_WEBHOOK_URL` | Incoming Webhook that targets the desired Slack channel. |

> The workflow automatically scopes deployments using the GitHub environment, so you can configure branch protection, required approvals, or different credentials per environment if needed.

### Manual deployment tooling

Helper scripts such as `create-deployment-package.sh` and the contents of `deployment/` remain available for direct deployments or troubleshooting outside of the CI/CD workflow.
