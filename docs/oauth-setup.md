# Google OAuth Configuration Guide

This document describes how to configure Google OAuth apps for each environment.

## Required OAuth Apps

Each environment requires a separate Google OAuth app in Google Cloud Console with the correct callback URLs registered.

### Development Environment

1. Create a new OAuth 2.0 Client ID in Google Cloud Console
2. Configure the following:
   - **Name**: Rotten Corn Backend - Development
   - **Authorized JavaScript origins**:
     - `https://api.dev.chatappserver.space`
     - `https://dev.chatappserver.space`
   - **Authorized redirect URIs**:
     - `https://api.dev.chatappserver.space/api/v1/auth/google/callback`
   - **Application type**: Web application

3. Copy the Client ID and Client Secret to the development environment variables:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

### Staging Environment

1. Create a new OAuth 2.0 Client ID in Google Cloud Console
2. Configure the following:
   - **Name**: Rotten Corn Backend - Staging
   - **Authorized JavaScript origins**:
     - `https://api.staging.chatappserver.space`
     - `https://staging.chatappserver.space`
   - **Authorized redirect URIs**:
     - `https://api.staging.chatappserver.space/api/v1/auth/google/callback`
   - **Application type**: Web application

3. Copy the Client ID and Client Secret to the staging environment variables in S3:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

### Production Environment

1. Create a new OAuth 2.0 Client ID in Google Cloud Console
2. Configure the following:
   - **Name**: Rotten Corn Backend - Production
   - **Authorized JavaScript origins**:
     - `https://api.chatappserver.space`
     - `https://chatappserver.space`
   - **Authorized redirect URIs**:
     - `https://api.chatappserver.space/api/v1/auth/google/callback`
   - **Application type**: Web application

3. Copy the Client ID and Client Secret to the production environment variables in S3:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

## Verification

After configuring OAuth apps, verify:

1. Each environment's OAuth health check endpoint returns the correct callback URL:
   - Development: `GET https://api.dev.chatappserver.space/api/v1/auth/health`
   - Staging: `GET https://api.staging.chatappserver.space/api/v1/auth/health`
   - Production: `GET https://api.chatappserver.space/api/v1/auth/health`

2. Test OAuth flow from each frontend:
   - Initiate OAuth from frontend
   - Verify redirect to Google
   - Verify callback URL matches registered URL
   - Verify successful authentication
