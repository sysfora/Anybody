import os
import json
import threading
import time
from pathlib import Path
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit, join_room
from dotenv import load_dotenv
import logging
import base64
from werkzeug.utils import secure_filename

from services.r2_service import R2Service
from services.project_manager import ProjectManager
from services.streaming_service import StreamingService
from services.pocketbase_service import PocketBaseService
from services.credit_service import CreditService
from services.openrouter_service import OpenRouterService
from utils.state_manager import StateManager

# Load environment variables
load_dotenv()

# Configure logging - ensure logs are visible in production
log_level = os.getenv('LOG_LEVEL', 'INFO').upper()
numeric_level = getattr(logging, log_level, logging.INFO)

# Configure root logger to output to stdout/stderr (visible in Docker/gunicorn)
logging.basicConfig(
    level=numeric_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    force=True  # Override any existing configuration (Python 3.8+)
)

# Get logger for this module
logger = logging.getLogger(__name__)
logger.setLevel(numeric_level)

app = Flask(__name__)

app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')
app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_ATTACHMENT_SIZE_MB', 10)) * 1024 * 1024 * int(os.getenv('MAX_ATTACHMENTS', 5))

# Use gevent mode in production (with gunicorn), threading in development
async_mode = 'gevent' if os.getenv('FLASK_ENV') == 'production' else 'threading'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode=async_mode)

# Initialize services
r2_service = R2Service()
state_manager = StateManager()
pocketbase_service = PocketBaseService()
credit_service = CreditService(pocketbase_service)
openrouter_service = OpenRouterService()

# Store active projects (needed before ProjectManager initialization)
active_projects = {}

project_manager = ProjectManager(r2_service, state_manager, socketio, active_projects)
# Pass cancelled_projects set to streaming service to avoid circular dependency
streaming_service = StreamingService(socketio, project_manager.cancelled_projects)

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'healthy'}), 200

@app.route('/api/projects/<username>/<project_name>/status', methods=['GET'])
def get_project_status(username, project_name):
    """Get project status"""
    project_id = f"{username}/{project_name}"
    state = state_manager.get_state(project_id)
    if state:
        return jsonify(state), 200
    return jsonify({'error': 'Project not found'}), 404

@app.route('/api/projects/<username>/<project_name>/cancel', methods=['POST'])
def cancel_project(username, project_name):
    """Cancel a running project"""
    project_id = f"{username}/{project_name}"
    if project_id in active_projects:
        project_manager.cancel_project(project_id)
        return jsonify({'message': 'Project cancellation requested'}), 200
    return jsonify({'error': 'Project not found or not running'}), 404

@app.route('/api/upload', methods=['POST'])
def upload_files():
    """Handle file uploads for attachments"""
    try:
        max_attachments = int(os.getenv('MAX_ATTACHMENTS', 5))
        max_size = int(os.getenv('MAX_ATTACHMENT_SIZE_MB', 10)) * 1024 * 1024
        
        if 'files' not in request.files:
            return jsonify({'error': 'No files provided'}), 400
        
        files = request.files.getlist('files')
        
        if len(files) > max_attachments:
            return jsonify({'error': f'Maximum {max_attachments} files allowed'}), 400
        
        attachments = []
        for file in files:
            if file.filename == '':
                continue
            
            # Check file size
            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)
            
            if file_size > max_size:
                return jsonify({'error': f'File {file.filename} exceeds {max_size} bytes'}), 400
            
            # Read file and encode as base64
            file_data = file.read()
            encoded_data = base64.b64encode(file_data).decode('utf-8')
            
            attachments.append({
                'name': secure_filename(file.filename),
                'data': encoded_data,
                'size': file_size,
                'type': file.content_type
            })
        
        return jsonify({
            'attachments': attachments,
            'count': len(attachments)
        }), 200
        
    except Exception as e:
        logger.error(f"Error uploading files: {str(e)}")
        return jsonify({'error': f'Upload failed: {str(e)}'}), 500

@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    logger.info(f"Client connected: {request.sid}")
    emit('connected', {'message': 'Connected to server'})

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    logger.info(f"Client disconnected: {request.sid}")

@socketio.on('start_generation')
def handle_start_generation(data):
    """Handle project generation start"""
    try:
        username = data.get('username')
        project_name = data.get('project_name')
        prompt = data.get('prompt')
        attachments = data.get('attachments', [])
        
        if not username or not project_name or not prompt:
            emit('error', {'message': 'Missing required fields: username, project_name, prompt'})
            return
        
        project_id = f"{username}/{project_name}"
        
        # Check and deduct credits before starting generation
        credit_result = credit_service.check_and_deduct_credits(username)
        
        if not credit_result['success']:
            # Handle insufficient credits
            error_type = credit_result.get('error', 'unknown')
            auto_reload_enabled = credit_result.get('auto_reload_enabled', False)
            auto_reload_failed = credit_result.get('auto_reload_failed', False)
            
            # Only emit credits_end if auto-reload is not enabled OR if auto-reload failed
            # If auto-reload is enabled and succeeds, we won't reach here (success=True)
            if error_type == 'insufficient_credits':
                # Emit credits_end event for frontend to show appropriate popup
                emit('credits_end', {
                    'message': 'Insufficient credits to start generation',
                    'available_credits': credit_result.get('available_credits', 0),
                    'required_credits': credit_service.credit_cost,
                    'user_plan': credit_result.get('user_plan', 'free'),
                    'auto_reload_enabled': auto_reload_enabled,
                    'auto_reload_failed': auto_reload_failed
                })
            else:
                # Other errors
                emit('error', {
                    'message': credit_result.get('error', 'Credit check failed'),
                    'error_type': error_type,
                    'available_credits': credit_result.get('available_credits', 0)
                })
            return
        
        # Credits deducted successfully, proceed with generation
        logger.info(f"Credits deducted for user {username}. Starting generation for {project_id}")

        # Check if project already exists
        state = state_manager.get_state(project_id)
        is_new_project = state is None or state.get('status') == 'not_started'

        # Get visibility from request (default to public)
        visibility = data.get('visibility', 'public')

        # Initialize project state BEFORE starting the thread
        initial_status = 'generating' if is_new_project else 'modifying'

        # Create or update project in PocketBase
        project_manager.pocketbase_service.create_or_update_project(
            project_id,
            username,
            project_name,
            initial_status,
            is_new_project,
            visibility
        )

        # Initialize state immediately
        project_manager.state_manager.update_state(project_id, {
            'project_id': project_id,
            'username': username,
            'project_name': project_name,
            'prompt': prompt,
            'status': initial_status,
            'current_step': 0,
            'is_new_project': is_new_project,
            'files': [],
            'chat_history': []
        })

        # Add user message to chat data
        project_manager.add_user_message(project_id, prompt)
        
        # Send updated chat data to client immediately so they see their message
        chat_data = project_manager.get_chat_data(project_id)
        emit('chat_data', chat_data)

        # Join the project room
        join_room(f"project:{project_id}")
        logger.info(f"Client {request.sid} joined room project:{project_id}")

        # Start generation in background thread (with skip_init=True to prevent re-initialization)
        thread = threading.Thread(
            target=project_manager.generate_project,
            args=(project_id, username, project_name, prompt, attachments, is_new_project, request.sid, visibility)
        )
        thread.daemon = True
        thread.start()

        active_projects[project_id] = {
            'thread': thread,
            'sid': request.sid,
            'cancelled': False
        }

        emit('generation_started', {
            'project_id': project_id,
            'is_new_project': is_new_project,
            'credits_deducted': credit_result.get('credits_deducted', False),
            'available_credits': credit_result.get('available_credits', 0)
        })
        
    except Exception as e:
        logger.error(f"Error starting generation: {str(e)}")
        emit('error', {'message': f'Failed to start generation: {str(e)}'})

@socketio.on('subscribe_to_project')
def handle_subscribe(data):
    """Subscribe to project updates"""
    try:
        username = data.get('username')
        project_name = data.get('project_name')
        print(f"📡 Client {request.sid} subscribing to project: {username}/{project_name}")

        if not username or not project_name:
            emit('error', {'message': 'Missing required fields: username, project_name'})
            return

        project_id = f"{username}/{project_name}"

        print(f"🔍 Checking active projects for {project_id}")

        # All clients subscribing must join the project room to receive updates
        join_room(f"project:{project_id}")
        print(f"✅ Client {request.sid} joined room project:{project_id}")


        state = state_manager.get_state(project_id)
        print(f"📊 Retrieved state for {project_id}: {state is not None}")
        
        # Get project visibility from PocketBase
        project_data = project_manager.pocketbase_service._find_project_by_name(username, project_name)
        if project_data and project_data.get('visibility'):
            if not state:
                state = {}
            state['visibility'] = project_data.get('visibility', 'public')
        
        # If state is still None, check if we can reconstruct it from disk
        if not state:
            project_dir = project_manager.output_dir / project_id.replace('/', '_')
            if project_dir.exists():
                state = {}
        
        if state:
            # Ensure state has minimal required fields if it was reconstructed (e.g. only visibility or from disk)
            if 'project_id' not in state:
                project_dir = project_manager.output_dir / project_id.replace('/', '_')
                if project_dir.exists():
                    logger.info(f"Reconstructing state for {project_id} from disk")
                    state['project_id'] = project_id
                    state['username'] = username
                    state['project_name'] = project_name
                    state['status'] = 'completed' # Default to completed for existing projects without state
                    
                    # reconstruct files list
                    files = []
                    for file_path in project_dir.rglob('*'):
                        if file_path.is_file() and 'node_modules' not in str(file_path) and '.git' not in str(file_path):
                            rel_path = str(file_path.relative_to(project_dir)).replace('\\', '/')
                            files.append(rel_path)
                    state['files'] = files

            print(f"📤 Sending project_state for {project_id} (status: {state.get('status')})")
            # Send current state
            emit('project_state', state)

            # Send chat data if available
            chat_data = project_manager.get_chat_data(project_id)
            if chat_data:
                print(f"💬 Sending chat_data for {project_id} ({len(chat_data.get('messages', []))} messages, {len(chat_data.get('steps', []))} steps)")
                emit('chat_data', chat_data, room=request.sid)
            else:
                print(f"❌ No chat data found for {project_id}")

            current_step = state.get('current_step', 0)
            status = state.get('status')

            # If project is completed, send file content for all files
            if status == 'completed':
                project_dir = project_manager.output_dir / project_id.replace('/', '_')
                if project_dir.exists() and state.get('files'):

                    for file_path in state.get('files', []):
                        # Convert relative path to absolute
                        absolute_path = project_dir / file_path
                        if absolute_path.exists() and absolute_path.is_file():
                            # Check if it's a binary file
                            ext = os.path.splitext(file_path)[1].lower()
                            is_binary = ext in ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
                                                '.pdf', '.zip', '.tar', '.gz', '.rar',
                                                '.exe', '.dll', '.so', '.dylib',
                                                '.woff', '.woff2', '.ttf', '.eot',
                                                '.mp4', '.mp3', '.avi', '.mov',
                                                '.db', '.sqlite', '.sqlite3']

                            if not is_binary:
                                try:
                                    # Read file content
                                    with open(absolute_path, 'r', encoding='utf-8', errors='ignore') as f:
                                        content = f.read()

                                    # Send file_start
                                    emit('file_start', {
                                        'project_id': project_id,
                                        'file_path': file_path,
                                        'file_name': os.path.basename(file_path),
                                        'step': 3,
                                        'is_binary': False
                                    }, room=request.sid)

                                    # Send full content immediately (no streaming)
                                    emit('file_content', {
                                        'project_id': project_id,
                                        'file_path': file_path,
                                        'content': content,
                                        'is_incremental': False,  # Full content, not incremental
                                        'step': 3
                                    }, room=request.sid)

                                    # Send file_end
                                    emit('file_end', {
                                        'project_id': project_id,
                                        'file_path': file_path,
                                        'step': 3
                                    }, room=request.sid)
                                except Exception as e:
                                    logger.error(f"Error reading file {file_path}: {str(e)}")

            # If project is still in Step 3 (Generating/Modifying files), use streaming for ALL files
            elif current_step == 3:
                print(f"🔄 Re-streaming all files for Step 3 project {project_id} (requested by {request.sid})")
                streaming_service.resume_streaming(project_id, request.sid, force_stream_all=True)

            # If project is beyond Step 3 but still running (building, uploading), send existing content immediately
            elif status in ['generating', 'building', 'uploading']:
                logger.info(f"🔄 Client {request.sid} re-subscribed during {status} (Step {current_step}) for {project_id}. Sending existing files.")
                project_dir = project_manager.output_dir / project_id.replace('/', '_')
                if project_dir.exists() and state.get('files'):
                    # Send content for all files that have already been streamed
                    for file_path in state.get('files', []):
                        absolute_path = project_dir / file_path
                        if absolute_path.exists() and absolute_path.is_file():
                            # Check if it's a binary file
                            ext = os.path.splitext(file_path)[1].lower()
                            is_binary = ext in ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
                                                '.pdf', '.zip', '.tar', '.gz', '.rar',
                                                '.exe', '.dll', '.so', '.dylib',
                                                '.woff', '.woff2', '.ttf', '.eot',
                                                '.mp4', '.mp3', '.avi', '.mov',
                                                '.db', '.sqlite', '.sqlite3']

                            if not is_binary:
                                try:
                                    # Read file content
                                    with open(absolute_path, 'r', encoding='utf-8', errors='ignore') as f:
                                        content = f.read()

                                    # Send file_start if not already sent
                                    emit('file_start', {
                                        'project_id': project_id,
                                        'file_path': file_path,
                                        'file_name': os.path.basename(file_path),
                                        'step': 3,
                                        'is_binary': False
                                    }, room=request.sid)

                                    # Send full content immediately (no streaming)
                                    emit('file_content', {
                                        'project_id': project_id,
                                        'file_path': file_path,
                                        'content': content,
                                        'is_incremental': False,  # Full content, not incremental
                                        'step': 3
                                    }, room=request.sid)

                                    # Send file_end to mark as complete
                                    emit('file_end', {
                                        'project_id': project_id,
                                        'file_path': file_path,
                                        'step': 3
                                    }, room=request.sid)
                                except Exception as e:
                                    logger.error(f"Error reading file {file_path}: {str(e)}")

                # Continue streaming remaining files (if any)
                streaming_service.resume_streaming(project_id, request.sid)
        else:
            print(f"❌ No state found for {project_id}")
            emit('error', {'message': 'Project not found'})
            
    except Exception as e:
        logger.error(f"Error subscribing to project: {str(e)}")
        emit('error', {'message': f'Failed to subscribe: {str(e)}'})

@socketio.on('animation_complete')
def handle_animation_complete(data):
    """Handle signal from frontend that an animation is finished"""
    project_id = data.get('project_id')
    file_path = data.get('file_path')
    if project_id and file_path:
        streaming_service.mark_animation_complete(project_id, file_path)

@socketio.on('request_file_content')
def handle_request_file_content(data):
    """Handle request for file content when manually selected"""
    try:
        username = data.get('username')
        project_name = data.get('project_name')
        file_path = data.get('file_path')
        
        if not username or not project_name or not file_path:
            emit('error', {'message': 'Missing required fields: username, project_name, file_path'})
            return
        
        project_id = f"{username}/{project_name}"
        project_dir = project_manager.output_dir / project_id.replace('/', '_')
        
        if not project_dir.exists():
            emit('error', {'message': 'Project not found'})
            return
        
        # Convert relative path to absolute
        absolute_path = project_dir / file_path
        if not absolute_path.exists() or not absolute_path.is_file():
            emit('error', {'message': 'File not found'})
            return
        
        # Check if it's a binary file
        ext = os.path.splitext(file_path)[1].lower()
        is_binary = ext in ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
                            '.pdf', '.zip', '.tar', '.gz', '.rar',
                            '.exe', '.dll', '.so', '.dylib',
                            '.woff', '.woff2', '.ttf', '.eot',
                            '.mp4', '.mp3', '.avi', '.mov',
                            '.db', '.sqlite', '.sqlite3']
        
        if is_binary:
            emit('file_start', {
                'project_id': project_id,
                'file_path': file_path,
                'file_name': os.path.basename(file_path),
                'step': 3,
                'is_binary': True
            }, room=request.sid)
            return
        
        try:
            # Read file content
            with open(absolute_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            
            # Send file_start
            emit('file_start', {
                'project_id': project_id,
                'file_path': file_path,
                'file_name': os.path.basename(file_path),
                'step': 3,
                'is_binary': False
            }, room=request.sid)
            
            # Send full content immediately (no streaming)
            emit('file_content', {
                'project_id': project_id,
                'file_path': file_path,
                'content': content,
                'is_incremental': False,  # Full content, not incremental
                'step': 3
            }, room=request.sid)
            
            # Send file_end to mark as complete
            emit('file_end', {
                'project_id': project_id,
                'file_path': file_path,
                'step': 3
            }, room=request.sid)
            
        except Exception as e:
            logger.error(f"Error reading file {file_path}: {str(e)}")
            emit('error', {'message': f'Failed to read file: {str(e)}'})
            
    except Exception as e:
        logger.error(f"Error handling file content request: {str(e)}")
        emit('error', {'message': f'Failed to get file content: {str(e)}'})

@app.route('/api/projects/update-visibility', methods=['POST'])
def update_project_visibility():
    """Update project visibility"""
    try:
        data = request.get_json()
        project_id = data.get('project_id')
        visibility = data.get('visibility')
        
        if not project_id or not visibility:
            return jsonify({'success': False, 'error': 'Missing required fields: project_id, visibility'}), 400
        
        if visibility not in ['public', 'private']:
            return jsonify({'success': False, 'error': 'Invalid visibility value. Must be "public" or "private"'}), 400
        
        success = project_manager.pocketbase_service.update_project_visibility(project_id, visibility)
        
        if success:
            return jsonify({'success': True, 'message': 'Visibility updated successfully'})
        else:
            return jsonify({'success': False, 'error': 'Failed to update visibility'}), 500
            
    except Exception as e:
        logger.error(f"Error updating project visibility: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    """Handle chat requests via OpenRouter"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
            
        messages = data.get('messages', [])
        model = data.get('model')
        
        if not messages:
            return jsonify({'error': 'No messages provided'}), 400
            
        response = openrouter_service.generate_chat_response(messages, model)
        
        if 'error' in response:
            return jsonify(response), 500
            
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    host = os.getenv('HOST', '0.0.0.0')
    socketio.run(app, host=host, port=port, debug=False, use_reloader=False, allow_unsafe_werkzeug=True)

