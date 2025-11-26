#!/bin/bash

aws s3 sync s3://chattapplication1-env-files/develop .
unzip env-file.zip
cp .env.develop .env
rm .env.develop
sed -i "s|^REDIS_HOST=.*|REDIS_HOST=redis://$ELASTICACHE_ENDPOINT:6379|g" .env
rm -rf env-file.zip
cp .env .env.develop
zip env-file.zip .env.develop
aws --region eu-central-1 s3 cp env-file.zip s3://chattapplication1-env-files/develop/
rm -rf .env*
rm -rf env-file.zip

