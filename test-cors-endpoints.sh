#!/bin/bash

# Test script to verify CORS headers on auth endpoints
# Usage: ./test-cors-endpoints.sh [base-url]
# Example: ./test-cors-endpoints.sh https://api.dev.chatappserver.space

BASE_URL="${1:-https://api.dev.chatappserver.space}"
ORIGIN="https://dev.chatappserver.space"

echo "=========================================="
echo "Testing CORS Headers for Auth Endpoints"
echo "=========================================="
echo "Base URL: $BASE_URL"
echo "Origin: $ORIGIN"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_cors() {
    local method=$1
    local endpoint=$2
    local description=$3
    local data=$4
    
    echo "----------------------------------------"
    echo "Testing: $description"
    echo "Method: $method"
    echo "Endpoint: $endpoint"
    echo ""
    
    if [ "$method" = "OPTIONS" ]; then
        response=$(curl -s -D - -X OPTIONS "$BASE_URL$endpoint" \
            -H "Origin: $ORIGIN" \
            -H "Access-Control-Request-Method: POST" \
            -H "Access-Control-Request-Headers: Content-Type" \
            --max-time 10)
    else
        if [ -n "$data" ]; then
            response=$(curl -s -D - -X "$method" "$BASE_URL$endpoint" \
                -H "Origin: $ORIGIN" \
                -H "Content-Type: application/json" \
                -H "Accept: application/json" \
                -d "$data" \
                --max-time 10)
        else
            response=$(curl -s -D - -X "$method" "$BASE_URL$endpoint" \
                -H "Origin: $ORIGIN" \
                -H "Content-Type: application/json" \
                -H "Accept: application/json" \
                --max-time 10)
        fi
    fi
    
    # Extract HTTP status code
    http_code=$(echo "$response" | head -1 | grep -oE 'HTTP/[0-9.]+ [0-9]+' | grep -oE '[0-9]+$')
    
    # Check for CORS headers
    has_origin=$(echo "$response" | grep -i "access-control-allow-origin" | head -1)
    has_credentials=$(echo "$response" | grep -i "access-control-allow-credentials" | head -1)
    has_methods=$(echo "$response" | grep -i "access-control-allow-methods" | head -1)
    has_headers=$(echo "$response" | grep -i "access-control-allow-headers" | head -1)
    
    echo "HTTP Status: $http_code"
    echo ""
    
    # Check if we got a response from the app or just the load balancer
    if echo "$response" | grep -q "awselb"; then
        echo -e "${YELLOW}⚠ Warning: Response is from AWS ELB, not the application${NC}"
        echo -e "${YELLOW}   This usually means the server is down or unhealthy${NC}"
        echo ""
    fi
    
    if [ -n "$has_origin" ]; then
        echo -e "${GREEN}✓ Access-Control-Allow-Origin:${NC}"
        echo "  $has_origin"
    else
        echo -e "${RED}✗ Missing Access-Control-Allow-Origin header${NC}"
    fi
    
    if [ -n "$has_credentials" ]; then
        echo -e "${GREEN}✓ Access-Control-Allow-Credentials:${NC}"
        echo "  $has_credentials"
    else
        echo -e "${YELLOW}⚠ Missing Access-Control-Allow-Credentials header${NC}"
    fi
    
    if [ -n "$has_methods" ]; then
        echo -e "${GREEN}✓ Access-Control-Allow-Methods:${NC}"
        echo "  $has_methods"
    else
        echo -e "${YELLOW}⚠ Missing Access-Control-Allow-Methods header${NC}"
    fi
    
    if [ -n "$has_headers" ]; then
        echo -e "${GREEN}✓ Access-Control-Allow-Headers:${NC}"
        echo "  $has_headers"
    else
        echo -e "${YELLOW}⚠ Missing Access-Control-Allow-Headers header${NC}"
    fi
    
    echo ""
    echo "Full Response Headers:"
    echo "$response" | head -20
    echo ""
}

# Test OPTIONS preflight for signup
test_cors "OPTIONS" "/api/v1/auth/signup" "OPTIONS Preflight - Signup"

# Test OPTIONS preflight for signin
test_cors "OPTIONS" "/api/v1/auth/signin" "OPTIONS Preflight - Signin"

# Test POST signup (will fail validation, but should have CORS headers)
test_cors "POST" "/api/v1/auth/signup" "POST Signup" '{"username":"testuser","email":"test@example.com","password":"testpass123","avatarColor":"blue","avatarImage":"data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="}'

# Test POST signin (will fail validation, but should have CORS headers)
test_cors "POST" "/api/v1/auth/signin" "POST Signin" '{"username":"testuser","password":"testpass123"}'

echo "=========================================="
echo "Testing Complete"
echo "=========================================="
echo ""
echo "Expected Results:"
echo "- All requests should include Access-Control-Allow-Origin: $ORIGIN"
echo "- All requests should include Access-Control-Allow-Credentials: true"
echo "- OPTIONS requests should return 200 status"
echo "- POST requests may return 400/401/500 (validation/auth errors), but should have CORS headers"
echo ""
echo "If CORS headers are missing, check:"
echo "1. Server is running and healthy"
echo "2. Code changes have been deployed"
echo "3. Server logs for CORS-related messages"


