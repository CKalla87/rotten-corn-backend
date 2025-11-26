#!/bin/bash

# CodeDeploy BeforeInstall hook
# This script runs before the application files are copied

DIR="/home/ec2-user/chatty-backend"
if [ -d "$DIR" ]; then
  cd /home/ec2-user
  sudo rm -rf chatty-backend
  echo "Removed existing chatty-backend directory"
else
  echo "Directory does not exist, creating it"
  mkdir -p /home/ec2-user/chatty-backend
fi

