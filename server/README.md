# Anybody Backend - Flask App for AI-Powered App Generation

A Flask application with WebSocket support for generating and modifying applications using AI based on user prompts.

## Features

- **WebSocket Streaming**: Real-time status updates and code preview streaming character by character
- **Project Management**: Support for both new project generation and existing project modification
- **R2 Storage Integration**: Upload/download projects from Cloudflare R2
- **Background Processing**: Projects continue running even when users disconnect
- **File Attachments**: Support for up to 5 files, 10MB max per file
- **Cancel Functionality**: Ability to cancel running projects
- **State Persistence**: Project state is saved and can be resumed
- **PocketBase Integration**: Projects are automatically tracked in PocketBase with status updates

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Environment Variables

Create a `.env` file in the `Anybody-Backend` directory with the following variables:

```env
# Flask Configuration
FLASK_APP=app.py
FLASK_ENV=development
SECRET_KEY=your-secret-key-here

# R2 Storage Configuration
R2_ACCOUNT_ID=your-r2-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET_NAME=your-r2-bucket-name
R2_ENDPOINT_URL=https://your-account-id.r2.cloudflarestorage.com

# Repository Configuration
REPO_URL=your-repo-url
REPO_BRANCH=main

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

# PocketBase Configuration (for project tracking)
POCKETBASE_URL=http://localhost:8090
POCKETBASE_ADMIN_EMAIL=your-admin-email@example.com
POCKETBASE_ADMIN_PASSWORD=your-admin-password
```

### 3. Run the Application

```bash
python app.py
```

The server will start on `http://localhost:5000` (or the port specified in your `.env` file).

## API Endpoints

### REST API

- `GET /health` - Health check endpoint
- `GET /api/projects/<username>/<project_name>/status` - Get project status
- `POST /api/projects/<username>/<project_name>/cancel` - Cancel a running project
- `POST /api/upload` - Upload attachment files (multipart/form-data)

### WebSocket Events

#### Client → Server

- `connect` - Connect to WebSocket
- `start_generation` - Start project generation
  ```json
  {
    "username": "user123",
    "project_name": "my-app",
    "prompt": "Create a todo app",
    "attachments": []
  }
  ```
- `subscribe_to_project` - Subscribe to project updates
  ```json
  {
    "username": "user123",
    "project_name": "my-app"
  }
  ```

#### Server → Client

- `connected` - Connection confirmed
- `generation_started` - Generation process started
- `status_update` - Status update with step number
- `file_start` - File streaming started
- `file_content` - File content chunk (character by character)
- `file_end` - File streaming completed
- `project_completed` - Project generation completed
- `project_cancelled` - Project was cancelled
- `project_error` - Error occurred during generation
- `build_error` - Build process error
- `upload_error` - Upload process error

## Workflow

1. **[1]** Starting up the generation/modification
2. **[2]** Cloning the repository (new projects) or Downloading from R2 (existing projects)
3. **[3]** Writing/modifying files (streaming character by character)
4. **[4]** Finalizing project structure
5. **[5]** Building the project (npm install + npm run build)
6. **[6]** Uploading to the cloud (dist folder and source folder)
7. **[7]** Project generation completed

## Project Structure

```
Anybody-Backend/
├── app.py                 # Main Flask application
├── requirements.txt       # Python dependencies
├── services/
│   ├── r2_service.py     # R2 storage operations
│   ├── project_manager.py # Project generation workflow
│   ├── streaming_service.py # File streaming service
│   └── pocketbase_service.py # PocketBase integration for project tracking
├── utils/
│   └── state_manager.py  # State persistence
├── states/               # Project state files (created at runtime)
└── output/                # Temporary project files (created at runtime)
```

## R2 Storage Structure

Projects are stored in R2 with the following structure:

```
{username}/{project_name}/
├── chat.json          # Chat history and steps
├── dist/              # Built files (Vite output)
└── source/            # Source code
    ├── assets/        # Uploaded attachments
    └── ...            # Other source files
```

## AI Integration

The `_generate_files` method in `services/project_manager.py` is where you should integrate your AI service. Currently, it streams existing files to demonstrate the workflow. You'll need to:

1. Add your AI service client (OpenAI, Anthropic, etc.)
2. Call the AI service with the user's prompt
3. Generate/modify files based on AI response
4. Stream the generated files character by character

See the TODO comment in `services/project_manager.py` for integration guidance.

## Notes

- Projects run in background threads and persist state
- Users can disconnect and reconnect to see progress
- File streaming happens character by character for live preview
- All configuration uses environment variables
- Maximum 5 attachments, 10MB per file
- Projects can be cancelled at any time
- AI integration point is clearly marked in the code

## Development

The application uses:
- Flask for the web framework
- Flask-SocketIO for WebSocket support
- boto3 for R2 storage operations
- GitPython for repository cloning
- python-dotenv for environment variable management
- pocketbase Python SDK for PocketBase integration

