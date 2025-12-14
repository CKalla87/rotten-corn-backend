#!/bin/bash

# Get specific logs from backend instance
# Usage: ./get-logs.sh <log-type> [lines]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="$SCRIPT_DIR/chatappKeyPair.pem"
BASTION="ec2-user@98.92.178.139"
BACKEND="ec2-user@10.0.4.64"
LINES=${2:-100}

run_on_backend() {
  ssh -i "$KEY_FILE" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ProxyCommand="ssh -i $KEY_FILE -W %h:%p $BASTION" \
      "$BACKEND" \
      "$@"
}

case "$1" in
  system|sys)
    echo "=== System Logs (last $LINES lines) ==="
    run_on_backend "sudo tail -$LINES /var/log/messages 2>/dev/null || sudo journalctl -n $LINES --no-pager 2>/dev/null || echo 'No system logs found'"
    ;;

  app|application)
    echo "=== Application Logs ==="
    echo "1. PM2 Application Logs:"
    run_on_backend "cd /home/ec2-user/rotten-corn-backend && pm2 logs rotten-corn-backend --lines $LINES --nostream 2>/dev/null || pm2 logs rotten-corn --lines $LINES --nostream 2>/dev/null || echo 'PM2 not running or no logs'"
    echo ""
    echo "2. CodeDeploy Deployment Logs:"
    DEPLOY_LOG=$(run_on_backend "ls -t /opt/codedeploy-agent/deployment-root/*/d-*/logs/scripts.log 2>/dev/null | head -1")
    if [ -n "$DEPLOY_LOG" ]; then
      run_on_backend "sudo tail -$LINES $DEPLOY_LOG"
    else
      echo "No CodeDeploy deployment logs found"
    fi
    echo ""
    echo "3. Application Directory Logs:"
    run_on_backend "find /home/ec2-user/rotten-corn-backend -name '*.log' -type f 2>/dev/null | head -5 | xargs -I {} tail -$LINES {} 2>/dev/null || echo 'No log files in app directory'"
    ;;

  codedeploy|cd)
    echo "=== CodeDeploy Agent Logs (last $LINES lines) ==="
    run_on_backend "sudo tail -$LINES /var/log/amazon/codedeploy-agent/codedeploy-agent.log 2>/dev/null || echo 'CodeDeploy agent log not found'"
    ;;

  userdata|ud)
    echo "=== User Data Script Logs (last $LINES lines) ==="
    run_on_backend "sudo tail -$LINES /var/log/user-data.log 2>/dev/null || echo 'User data log not found'"
    ;;

  cloud-init|ci)
    echo "=== Cloud-Init Logs ==="
    run_on_backend "sudo tail -$LINES /var/log/cloud-init.log 2>/dev/null || sudo tail -$LINES /var/log/cloud-init-output.log 2>/dev/null || echo 'Cloud-init logs not found'"
    ;;

  nginx|web)
    echo "=== Nginx Logs ==="
    run_on_backend "sudo tail -$LINES /var/log/nginx/error.log 2>/dev/null || echo 'Nginx not installed or logs not found'"
    ;;

  pm2)
    echo "=== PM2 Logs ==="
    echo "PM2 Process List:"
    run_on_backend "cd /home/ec2-user/rotten-corn-backend && pm2 list 2>/dev/null || echo 'PM2 not running'"
    echo ""
    echo "PM2 Logs (rotten-corn-backend):"
    run_on_backend "cd /home/ec2-user/rotten-corn-backend && pm2 logs rotten-corn-backend --lines $LINES --nostream 2>/dev/null || pm2 logs rotten-corn --lines $LINES --nostream 2>/dev/null || echo 'No PM2 logs found'"
    echo ""
    echo "PM2 Error Logs:"
    run_on_backend "cd /home/ec2-user/rotten-corn-backend && pm2 logs rotten-corn-backend --err --lines $LINES --nostream 2>/dev/null || pm2 logs rotten-corn --err --lines $LINES --nostream 2>/dev/null || echo 'No PM2 error logs'"
    ;;

  process|ps)
    echo "=== Running Processes ==="
    run_on_backend "ps aux | grep -E 'node|npm|pm2|app' | grep -v grep"
    echo ""
    echo "=== Service Status ==="
    run_on_backend "systemctl list-units --type=service --state=running | grep -E 'app|node|chatapp' || echo 'No matching services'"
    ;;

  errors|error)
    echo "=== Recent Errors ==="
    run_on_backend "sudo grep -i error /var/log/messages 2>/dev/null | tail -$LINES || sudo journalctl -p err -n $LINES --no-pager 2>/dev/null || echo 'No error logs found'"
    ;;

  all)
    echo "=== All Logs ==="
    echo ""
    echo "1. System Logs:"
    run_on_backend "sudo tail -50 /var/log/messages 2>/dev/null || sudo journalctl -n 50 --no-pager 2>/dev/null"
    echo ""
    echo "2. CodeDeploy Agent:"
    run_on_backend "sudo tail -50 /var/log/amazon/codedeploy-agent/codedeploy-agent.log 2>/dev/null"
    echo ""
    echo "3. User Data:"
    run_on_backend "sudo tail -50 /var/log/user-data.log 2>/dev/null"
    echo ""
    echo "4. Application Processes:"
    run_on_backend "ps aux | grep -E 'node|npm|pm2' | grep -v grep"
    ;;

  *)
    echo "Usage: $0 <log-type> [lines]"
    echo ""
    echo "Log types:"
    echo "  system, sys          - System logs"
    echo "  app, application     - Application logs"
    echo "  codedeploy, cd       - CodeDeploy agent logs"
    echo "  userdata, ud         - User data script logs"
    echo "  cloud-init, ci       - Cloud-init logs"
    echo "  nginx, web           - Nginx web server logs"
    echo "  pm2                  - PM2 process manager logs"
    echo "  process, ps          - Running processes"
    echo "  errors, error        - Error logs"
    echo "  all                  - All logs"
    echo ""
    echo "Examples:"
    echo "  $0 codedeploy 200    - Get last 200 lines of CodeDeploy logs"
    echo "  $0 app               - Get application logs (default 100 lines)"
    echo "  $0 errors             - Get error logs"
    exit 1
    ;;
esac

