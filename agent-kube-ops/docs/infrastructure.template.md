# Infrastructure Reference

Copy this file to `infrastructure.md` and fill in your values.

## AWS Account

account_id: <your-account-id>
region: <your-region>

## IAM

iam_role: arn:aws:iam::<account-id>:role/<role-name>

## RDS

rds_endpoint: <your-rds-endpoint>
rds_port: 5432
rds_connection: postgresql://<your-rds-endpoint>:5432

## S3

s3_bucket: <your-s3-bucket>
s3_url: https://<your-s3-url>/

## ECR

ecr_repository: <your-ecr-repo-name>
ecr_repository_uri: <account-id>.dkr.ecr.<region>.amazonaws.com/<repo-name>

## Kubernetes Ingress

ingress_dns: <your-alb-dns>.<region>.elb.amazonaws.com

## Certificate Manager

acm_certificate_arn: arn:aws:acm:<region>:<account-id>:certificate/<cert-id>
