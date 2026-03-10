# Environment Variables Setup Guide

## Backend (.env)

Create a `.env` file in the `Anybody-Backend` directory with the following variables:

```env
# Flask Configuration
FLASK_APP=app.py
FLASK_ENV=development
SECRET_KEY=your-secret-key-here-change-this-in-production

# R2 Storage Configuration
R2_ACCOUNT_ID=your-r2-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET_NAME=your-r2-bucket-name
R2_ENDPOINT_URL=https://your-account-id.r2.cloudflarestorage.com

# Repository Configuration
REPO_URL=https://github.com/your-username/your-repo.git
REPO_BRANCH=main
GITHUB_TOKEN=your-github-personal-access-token

# Server Configuration
HOST=0.0.0.0
PORT=5000

# File Upload Configuration
MAX_ATTACHMENTS=5
MAX_ATTACHMENT_SIZE_MB=10

# State Management
STATE_DIR=states

# Output Directory
OUTPUT_DIR=output

# Anthropic AI Configuration
ANTHROPIC_API_KEY=your-anthropic-api-key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_MAX_ITERATIONS=10

# Build Configuration
BUILD_MAX_RETRIES=3
```

### Getting an Anthropic API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key and use it as `ANTHROPIC_API_KEY` in your `.env` file

**Note**: Keep your API key secure and never commit it to version control!

### Getting a GitHub Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a name and select scopes:
   - `repo` (Full control of private repositories) - Required for private repos
4. Copy the token and use it as `GITHUB_TOKEN` in your `.env` file

**Note**: Keep your token secure and never commit it to version control!

## Frontend (.env.local)

Create a `.env.local` file in the `Anybody-Frontend` directory:

```env
# Backend API Configuration
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_WS_URL=http://localhost:5000

# File Upload Configuration
NEXT_PUBLIC_MAX_ATTACHMENTS=5
NEXT_PUBLIC_MAX_ATTACHMENT_SIZE_MB=10
```

### Production Configuration

For production, update the URLs:

```env
NEXT_PUBLIC_API_URL=https://your-backend-domain.com
NEXT_PUBLIC_WS_URL=https://your-backend-domain.com
```

## Security Notes

1. **Never commit `.env` or `.env.local` files to git**
2. Use strong, unique values for `SECRET_KEY` in production
3. Rotate GitHub tokens regularly
4. Use environment-specific values for production vs development
5. Consider using secrets management services for production (AWS Secrets Manager, etc.)

