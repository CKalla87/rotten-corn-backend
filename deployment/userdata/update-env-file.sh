#!/bin/bash

aws s3 sync s3://chattapplication1-env-files/staging .
unzip env-file.zip
cp .env.production .env
rm .env.production
sed -i "s|^REDIS_HOST=.*|REDIS_HOST=redis://$ELASTICACHE_ENDPOINT:6379|g" .env
rm -rf env-file.zip
cp .env .env.production
zip env-file.zip .env.production
aws --region eu-central-1 s3 cp env-file.zip s3://chattapplication1-env-files/staging/
rm -rf .env*
rm -rf env-file.zip

