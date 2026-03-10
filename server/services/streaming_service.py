import os
import time
import threading
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class StreamingService:
    """Service for streaming file contents character by character"""
    
    def __init__(self, socketio, cancelled_projects_set=None):
        self.socketio = socketio
        # Use the same set reference to check cancellation status
        self._cancelled_projects = cancelled_projects_set if cancelled_projects_set is not None else set()
        self.active_streams = {}  # project_id -> {sid, thread, cancelled}
        
        # Binary file extensions to skip animation
        self.binary_extensions = {
            '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',  # Images
            '.pdf', '.zip', '.tar', '.gz', '.rar',  # Archives
            '.exe', '.dll', '.so', '.dylib',  # Binaries
            '.woff', '.woff2', '.ttf', '.eot',  # Fonts
            '.mp4', '.mp3', '.avi', '.mov',  # Media
            '.db', '.sqlite', '.sqlite3',  # Databases
        }
        
        # Track animation completion events from clients
        self.animation_events = {}  # (project_id, file_path) -> threading.Event

    def wait_for_animation(self, project_id: str, file_path: str):
        """Wait for the frontend to signal that an animation is complete"""
        # Ensure we use normalized relative path
        if 'output' in Path(file_path).parts:
            output_idx = Path(file_path).parts.index('output')
            if output_idx + 2 < len(Path(file_path).parts):
                relative_path = str(Path(*Path(file_path).parts[output_idx + 2:]))
            else:
                relative_path = os.path.basename(file_path)
        else:
            relative_path = file_path
        
        relative_path = relative_path.replace('\\', '/')
        key = (project_id, relative_path)
        
        if key not in self.animation_events:
            self.animation_events[key] = threading.Event()
        
        event = self.animation_events[key]
        
        # Wait for the event to be set
        if not event.wait(timeout=5.0):
            logger.warning(f"Timeout waiting for animation complete signal for {file_path}")
        
       
        # Clean up
        self.animation_events.pop(key, None)

    def mark_animation_complete(self, project_id: str, file_path: str):
        """Signal from frontend that an animation is finished"""
        # Normalize path
        relative_path = file_path.replace('\\', '/')
        key = (project_id, relative_path)
        
        if key in self.animation_events:
            self.animation_events[key].set()
        else:
            # Maybe the event hasn't been created yet or backend isn't waiting
            # We can create it and set it just in case of race conditions
            event = threading.Event()
            event.set()
            self.animation_events[key] = event
    
    def _is_binary_file(self, file_path: str) -> bool:
        """Check if a file is binary based on extension"""
        ext = os.path.splitext(file_path)[1].lower()
        return ext in self.binary_extensions
    
    def stream_file(self, file_path: str, project_id: str, sid: str, step_number: int, target_sid: str = None, stream_characters: bool = True):
        """Stream a file - either character by character or immediately"""
        try:
            if not os.path.exists(file_path):
                logger.warning(f"File not found: {file_path}")
                return
            
            file_name = os.path.basename(file_path)
            target_room = target_sid if target_sid else f"project:{project_id}"
            
            # Get relative path from project directory
            path_parts = Path(file_path).parts
            if 'output' in path_parts:
                output_idx = path_parts.index('output')
                if output_idx + 2 < len(path_parts):
                    relative_path = str(Path(*path_parts[output_idx + 2:]))
                else:
                    relative_path = file_name
            else:
                relative_path = file_path.replace(os.getcwd(), '').lstrip('/\\')
            
            relative_path = relative_path.replace('\\', '/')
            is_binary = self._is_binary_file(file_path)
            
            if is_binary:
                logger.info(f"Skipping binary file: {relative_path}")
                return
            
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
            except Exception as e:
                logger.warning(f"Could not read file as text: {file_path}, error: {str(e)}")
                return
            
            self.socketio.emit('file_start', {
                'project_id': project_id,
                'file_path': relative_path,
                'file_name': file_name,
                'step': step_number
            }, room=target_room)
            
            content_length = len(content)
            
            time.sleep(0.1)

            if not stream_characters:
                # Send full content immediately
                self.socketio.emit('file_content', {
                    'project_id': project_id,
                    'file_path': relative_path,
                    'content': content,
                    'is_incremental': False,
                    'step': step_number
                }, room=target_room)
                
                time.sleep(0.05)
                
                self.socketio.emit('file_end', {
                    'project_id': project_id,
                    'file_path': relative_path,
                    'step': step_number
                }, room=target_room)
                return

            # Character by character streaming
            stream_key = f"{project_id}_{file_path}"
            if stream_key not in self.active_streams:
                self.active_streams[stream_key] = {'cancelled': False, 'sid': sid}
            
            char_delay = 0.0005  # Reduced from 0.005 to 0.5ms for faster streaming
            chunk_size = 50
            current_chunk = ""
            sent_length = 0
            
            for i, char in enumerate(content):
                if self.active_streams.get(stream_key, {}).get('cancelled', False):
                    break
                
                current_chunk += char
                
                if len(current_chunk) >= chunk_size or i == len(content) - 1:
                    new_content = current_chunk
                    self.socketio.emit('file_content', {
                        'project_id': project_id,
                        'file_path': relative_path,
                        'content': new_content,
                        'is_incremental': True,
                        'step': step_number
                    }, room=target_room)
                    sent_length += len(current_chunk)
                    current_chunk = ""
                    time.sleep(char_delay * chunk_size)
            
            # Wait for frontend animation to complete
            # Frontend typewriter speed: 2ms per character (approx 5 chars per tick)
            frontend_animation_speed = 0.002
            frontend_animation_time = content_length * frontend_animation_speed
            
            animation_wait_time = frontend_animation_time + 0.2
            logger.info(f"File {relative_path}: {content_length} chars, waiting {animation_wait_time:.2f}s for animation")
            time.sleep(animation_wait_time)
            
            self.socketio.emit('file_end', {
                'project_id': project_id,
                'file_path': relative_path,
                'step': step_number
            }, room=target_room)
            
            if stream_key in self.active_streams:
                del self.active_streams[stream_key]
            
            logger.info(f"Completed streaming file: {relative_path}")
                
        except Exception as e:
            logger.error(f"Error streaming file {file_path}: {str(e)}")
            self.socketio.emit('file_error', {
                'project_id': project_id,
                'file_path': file_path,
                'error': str(e),
                'step': step_number
            }, room=f"project:{project_id}")
    
    def stream_directory(self, directory: str, project_id: str, sid: str, step_number: int):
        """Stream all files in a directory"""
        try:
            dir_path = Path(directory)
            if not dir_path.exists():
                logger.warning(f"Directory not found: {directory}")
                return
            
            # Get all files
            files = []
            for file_path in dir_path.rglob('*'):
                if file_path.is_file():
                    # Skip node_modules and other build artifacts
                    if 'node_modules' in str(file_path) or '.git' in str(file_path):
                        continue
                    files.append(str(file_path))
            
            # Stream each file
            for file_path in files:
                if project_id in self._cancelled_projects:
                    break
                self.stream_file(file_path, project_id, sid, step_number)
                
        except Exception as e:
            logger.error(f"Error streaming directory {directory}: {str(e)}")
    
    def cancel_streaming(self, project_id: str):
        """Cancel streaming for a project"""
        for key in list(self.active_streams.keys()):
            if key.startswith(project_id):
                self.active_streams[key]['cancelled'] = True
    
    def resume_streaming(self, project_id: str, sid: str, force_stream_all: bool = False):
        """Resume streaming for a reconnected client"""
        # Get the project state to see which files have been streamed
        from utils.state_manager import StateManager
        state_manager = StateManager()
        state = state_manager.get_state(project_id)
        
        if not state:
            logger.warning(f"Cannot resume streaming: no state found for {project_id}")
            return
        
        # Get project directory
        output_dir = Path(os.getenv('OUTPUT_DIR', 'output'))
        username, project_name = project_id.split('/')
        project_dir = output_dir / f"{username}_{project_name}"
        
        if not project_dir.exists():
            logger.warning(f"Cannot resume streaming: project directory not found: {project_dir}")
            return
        
        # Get list of files that have been streamed
        streamed_files = set(state.get('files', []))
        
        # Get all files in project that should be streamed
        files = []
        priority_files = []
        
        skip_patterns = [
            'node_modules', '.git', 'dist', '.next',
            'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
            '.DS_Store', 'Thumbs.db', '.env.local', '.env',
            'chat.json','components/ui'
        ]
        
        priority_patterns = ['App.tsx', 'App.jsx', 'index.html', 'App.css', 'index.css']
        
        def is_binary_file(file_path):
            binary_extensions = {
                '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
                '.pdf', '.zip', '.tar', '.gz', '.rar',
                '.exe', '.dll', '.so', '.dylib',
                '.woff', '.woff2', '.ttf', '.eot',
                '.mp4', '.mp3', '.avi', '.mov',
                '.db', '.sqlite', '.sqlite3',
            }
            return Path(file_path).suffix.lower() in binary_extensions
        
        for file_path in project_dir.rglob('*'):
            if file_path.is_file():
                file_str = str(file_path)
                
                if any(skip in file_str for skip in skip_patterns):
                    continue
                
                if is_binary_file(file_path):
                    continue
                
                # Get relative path
                relative_path = str(file_path.relative_to(project_dir))
                relative_path = relative_path.replace('\\', '/')
                
                # Stream files that haven't been streamed yet OR all files if force_stream_all is True
                if force_stream_all or relative_path not in streamed_files:
                    file_name = file_path.name
                    if any(priority in file_name for priority in priority_patterns):
                        priority_files.append(str(file_path))
                    else:
                        files.append(str(file_path))
        
        # Add priority files at the end
        files.extend(priority_files)
        
        # Stream files
        if files:
            logger.info(f"Streaming for {project_id}: {len(files)} files (force_all={force_stream_all})")
            
            # Track file count to limit animation to first 3 files
            files_seen_by_client = 0
            
            for file_path in files:
                # Use target_sid=sid to only stream to the user who refreshed
                stream_characters = files_seen_by_client < 3
                self.stream_file(file_path, project_id, sid, 3, target_sid=sid, stream_characters=stream_characters)
                files_seen_by_client += 1
                
                if stream_characters:
                    time.sleep(0.05)  # Small buffer between animated files
                else:
                    time.sleep(0.01) # Faster buffer for immediate files
                
                # Update state if new file (not forced)
                relative_path = str(Path(file_path).relative_to(project_dir))
                relative_path = relative_path.replace('\\', '/')
                files_list = state.get('files', [])
                if relative_path not in files_list:
                    files_list.append(relative_path)
                    state_manager.update_state(project_id, {'files': files_list})
        else:
            logger.info(f"No files to stream for {project_id}")

