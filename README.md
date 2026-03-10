# Anybody Frontend - AI App Generator

Next.js frontend for the AI-powered app generation system.

## Features

- **Real-time WebSocket Connection**: Live status updates and code streaming
- **File Upload**: Support for up to 5 attachments, 10MB each
- **Status Tracking**: Numbered step-by-step progress display
- **Code Preview**: Character-by-character file streaming display
- **Project Management**: Start, cancel, and resume project generation
- **Reconnection Handling**: Automatically reconnects and resumes progress

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Create a `.env.local` file in the `Anybody-Frontend` directory:

```env
# Backend API Configuration
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_WS_URL=http://localhost:5000

# File Upload Configuration
NEXT_PUBLIC_MAX_ATTACHMENTS=5
NEXT_PUBLIC_MAX_ATTACHMENT_SIZE_MB=10
```

### 3. Run Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

## Project Structure

```
Anybody-Frontend/
├── app/
│   ├── page.tsx           # Main application page
│   ├── layout.tsx         # Root layout
│   └── globals.css        # Global styles
├── components/
│   ├── FileUpload.tsx     # File upload component
│   ├── FileStream.tsx     # Code streaming display
│   └── StatusDisplay.tsx  # Status update display
├── lib/
│   ├── socket.ts          # WebSocket connection utility
│   └── api.ts             # REST API client
└── package.json           # Dependencies
```

## Usage

1. **Enter Project Details**: Fill in username, project name, and prompt
2. **Add Attachments** (Optional): Upload up to 5 files, 10MB each
3. **Start Generation**: Click "Start Generation" to begin
4. **Monitor Progress**: Watch real-time status updates and code streaming
5. **Cancel if Needed**: Use "Cancel Project" to stop generation
6. **Resume Connection**: If disconnected, use "Resume Connection" to reconnect

## WebSocket Events

### Client → Server

- `start_generation` - Start project generation
- `subscribe_to_project` - Subscribe to project updates

### Server → Client

- `connected` - Connection confirmed
- `generation_started` - Generation process started
- `status_update` - Status update with step number
- `file_start` - File streaming started
- `file_content` - File content chunk
- `file_end` - File streaming completed
- `project_completed` - Project generation completed
- `project_cancelled` - Project was cancelled
- `project_error` - Error occurred
- `build_error` - Build process error
- `upload_error` - Upload process error

## Features

- **Real-time Updates**: All status changes and file content stream in real-time
- **Auto-scroll**: Code preview automatically scrolls as content streams
- **Error Handling**: Clear error messages for all failure scenarios
- **Responsive Design**: Works on desktop and mobile devices
- **TypeScript**: Full type safety throughout the application

## Development

Built with:
- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Socket.IO Client

## Notes

- Make sure the backend server is running before starting the frontend
- WebSocket connection automatically reconnects on disconnect
- File uploads are validated before sending to backend
- All configuration uses environment variables
