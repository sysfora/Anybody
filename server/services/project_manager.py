import os
import json
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import List
import logging
import traceback
import tempfile
import base64

from git import Repo
from services.pocketbase_service import PocketBaseService
from services.ai_service import AIService
from services.code_extractor import CodeExtractor

logger = logging.getLogger(__name__)

class ProjectManager:
    """Manages project generation and modification"""
    
    def __init__(self, r2_service, state_manager, socketio, active_projects):
        self.r2_service = r2_service
        self.state_manager = state_manager
        self.socketio = socketio
        self.active_projects = active_projects
        self.cancelled_projects = set()
        self.output_dir = Path(os.getenv('OUTPUT_DIR', 'output'))
        self.repo_url = os.getenv('REPO_URL')
        self.repo_branch = os.getenv('REPO_BRANCH', 'main')
        self.max_attachments = int(os.getenv('MAX_ATTACHMENTS', 5))
        self.max_attachment_size = int(os.getenv('MAX_ATTACHMENT_SIZE_MB', 10)) * 1024 * 1024
        # Store chat data in memory before saving to file
        self.chat_data = {}  # {project_id: {'messages': [], 'steps': []}}
        # Thread synchronization events
        self._building_started_events = {}  # {project_id: threading.Event}
        self._streaming_stopped_events = {}  # {project_id: threading.Event}
        self._ai_generation_complete_events = {}  # {project_id: threading.Event}
        self._streaming_complete_events = {}  # {project_id: threading.Event}
        self.template_files = {}  # {project_id: set(file_paths)}
        self.ai_processed_files = {}  # {project_id: set(file_paths)}
        # Initialize PocketBase service
        self.pocketbase_service = PocketBaseService()
        # Initialize AI service
        try:
            self.ai_service = AIService()
        except Exception as e:
            logger.error(f"Failed to initialize AI service: {str(e)}")
            self.ai_service = None
        # Build retry configuration
        self.build_max_retries = int(os.getenv('BUILD_MAX_RETRIES', '3'))
    
    def _emit_status(self, project_id: str, step: int, message: str, sid: str = None):
        """Emit status update with logging and state persistence"""
        status_data = {
            'project_id': project_id,
            'step': step,
            'message': message,
            'timestamp': time.time()
        }

        # Broadcast to project room and log
        logger.info(f"STATUS UPDATE: Step {step} - {message} for {project_id}")
        self.socketio.emit('status_update', status_data, room=f"project:{project_id}")
        
        # Store step in chat data
        if project_id not in self.chat_data:
            self.chat_data[project_id] = {'messages': [], 'steps': []}
        
        self.chat_data[project_id]['steps'].append({
            'step': step,
            'message': message,
            'timestamp': time.time()
        })
        
        # Determine status based on step and current project state
        state = self.state_manager.get_state(project_id) or {}
        current_status = state.get('status', 'generating')
        is_new_project = state.get('is_new_project', True)
        
        # Determine status based on step
        if step == 3:
            # For step 3, use the project type (new vs modification)
            status = 'generating' if is_new_project else 'modifying'
        elif step == 4:
            status = 'building'
        elif step == 5:
            status = 'building'
        elif step == 6:
            status = 'uploading'
        elif step == 7:
            status = 'completed'
        else:
            # For other steps, preserve current status if it's generating/modifying
            if current_status in ['generating', 'modifying']:
                status = current_status
            else:
                status = 'generating' if is_new_project else 'modifying'
        
        # Update state
        self.state_manager.update_state(project_id, {
            'current_step': step,
            'current_message': message,
            'status': status
        })
        
        # Update PocketBase status
        self.pocketbase_service.update_project_status(project_id, status)
        
        # Save chat.json to persist steps
        self._save_chat_json(project_id)
    
    def _check_cancelled(self, project_id: str):
        """Check if project is cancelled"""
        return project_id in self.cancelled_projects
    
    def cancel_project(self, project_id: str):
        """Cancel a project"""
        self.cancelled_projects.add(project_id)
        self.state_manager.update_state(project_id, {
            'status': 'cancelled',
            'current_message': 'Project cancelled by user'
        })
        # Update PocketBase status
        self.pocketbase_service.update_project_status(project_id, 'cancelled')
        
        # Clean up chat data to prevent old data from being sent if resubscribed
        if project_id in self.chat_data:
            del self.chat_data[project_id]
            logger.info(f"Cleaned up chat data for cancelled project: {project_id}")
        
        self.socketio.emit('project_cancelled', {'project_id': project_id}, room=f"project:{project_id}")
    
    def _save_attachments(self, attachments: list, project_dir: Path):
        """Save uploaded attachments to assets folder"""
        assets_dir = project_dir / 'assets'
        assets_dir.mkdir(exist_ok=True)
        
        saved_files = []
        for i, attachment in enumerate(attachments[:self.max_attachments]):
            try:
                # Decode base64 if needed
                if isinstance(attachment, dict):
                    file_data = attachment.get('data', '')
                    file_name = attachment.get('name', f'attachment_{i}')
                    
                    if file_data.startswith('data:'):
                        # Remove data URL prefix
                        header, encoded = file_data.split(',', 1)
                        file_data = base64.b64decode(encoded)
                    else:
                        file_data = base64.b64decode(file_data)
                    
                    # Check size
                    if len(file_data) > self.max_attachment_size:
                        logger.warning(f"Attachment {file_name} exceeds size limit")
                        continue
                    
                    # Save file
                    file_path = assets_dir / file_name
                    with open(file_path, 'wb') as f:
                        f.write(file_data)
                    
                    saved_files.append(str(file_path.relative_to(project_dir)))
                    logger.info(f"Saved attachment: {file_path}")
            except Exception as e:
                logger.error(f"Error saving attachment {i}: {str(e)}")
        
        return saved_files
    
    def generate_project(self, project_id: str, username: str, project_name: str, 
                        prompt: str, attachments: list, is_new_project: bool, sid: str, visibility: str = "public"):
        """Main project generation workflow"""
        try:
            # Initialize chat data in memory if not already initialized
            # Note: User message is already added via add_user_message() in app.py before this method is called
            # Initialize chat data in memory if not already initialized
            # Note: User message is already added via add_user_message() in app.py before this method is called
            # Initialize chat data in memory if not already initialized
            # Note: User message is already added via add_user_message() in app.py before this method is called
            # Initialize chat data in memory if not already initialized
            # Note: User message is already added via add_user_message() in app.py before this method is called
            if project_id not in self.chat_data:
                self.chat_data[project_id] = {
                    'messages': [],
                    'steps': []
                }
            else:
                # Ensure steps are cleared for new session (should already be done in add_user_message, but safety first)
                self.chat_data[project_id]['steps'] = []
            
            # Determine initial status
            initial_status = 'generating' if is_new_project else 'modifying'
            
            # Create or update project in PocketBase
            self.pocketbase_service.create_or_update_project(
                project_id, 
                username, 
                project_name, 
                initial_status,
                is_new_project,
                visibility
            )
            
            # Initialize state
            self.state_manager.update_state(project_id, {
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
            
            # Step 1: Starting up
            self._emit_status(project_id, 1, 
                            f"Starting up the {'generation' if is_new_project else 'modification'}", sid)
            
            if self._check_cancelled(project_id):
                return
            
            # Create project directory
            project_dir = self.output_dir / project_id.replace('/', '_')
            
            # Clean up existing directory if it's a new project to ensure no leftovers
            if project_dir.exists():
                try:
                    shutil.rmtree(project_dir)
                    logger.info(f"Cleaned up existing directory for project: {project_dir}")
                except Exception as e:
                    logger.warning(f"Failed to clean up directory {project_dir}: {str(e)}")
            
            project_dir.mkdir(parents=True, exist_ok=True)
            
            # Step 2: Setup project directory
            # If modifying, check if output exists first, then R2, then clone
            if not is_new_project:
                if project_dir.exists() and any(project_dir.iterdir()):
                    self._emit_status(project_id, 2, "Using existing project from output", sid)
                    # Load existing chat.json if available
                    self._load_chat_json(project_id, project_dir, load_steps=False)
                elif self.r2_service.project_exists(project_id):
                    # Download from R2
                    self._emit_status(project_id, 2, "Downloading project from cloud", sid)
                    if not self._download_project(project_id, project_dir, sid):
                        return
                    # Load existing chat.json if available
                    self._load_chat_json(project_id, project_dir, load_steps=False)
                else:
                    # Fallback to clone if R2 doesn't have it
                    self._emit_status(project_id, 2, "Cloning the repository", sid)
                    if not self._clone_repository(project_id, project_dir, sid):
                        return
                    self._save_chat_json(project_id, project_dir)
            else:
                # New project: check R2 first, then clone
                if self.r2_service.project_exists(project_id):
                    self._emit_status(project_id, 2, "Downloading project from cloud", sid)
                    if not self._download_project(project_id, project_dir, sid):
                        return
                    self._load_chat_json(project_id, project_dir, load_steps=False)
                else:
                    # New project: clone repository if URL is provided to use as a template
                    if self.repo_url:
                        self._emit_status(project_id, 2, "Cloning the repository", sid)
                        if not self._clone_repository(project_id, project_dir, sid):
                            # Continue anyway if clone fails, but log it
                            logger.warning(f"Failed to clone template repository for {project_id}")
                    else:
                        # Show Step 2 status without cloning
                        self._emit_status(project_id, 2, "Preparing workspace", sid)
                        # Template cloning disabled - starting from scratch
            
            if self._check_cancelled(project_id):
                return
            
            # Save attachments
            if attachments:
                self._emit_status(project_id, 2, "Saving attachments", sid)
                saved_attachments = self._save_attachments(attachments, project_dir)
                self.state_manager.update_state(project_id, {
                    'attachments': saved_attachments
                })
            
            # Step 3: Generate/Modify files using AI
            status_message = "Writing files" if is_new_project else "Modifying files"
            self._emit_status(project_id, 3, status_message, sid)
            
            # Create thread synchronization events for this project
            self._building_started_events[project_id] = threading.Event()
            self._streaming_stopped_events[project_id] = threading.Event()
            self._ai_generation_complete_events[project_id] = threading.Event()
            self._streaming_complete_events[project_id] = threading.Event()
            
            # Snapshot template files to prioritize AI-generated files later
            self.template_files[project_id] = set()
            for file_path in project_dir.rglob('*'):
                if file_path.is_file():
                    self.template_files[project_id].add(str(file_path))
            logger.info(f"Snapshotted {len(self.template_files[project_id])} template files for prioritization")
            
            # Optimize prompt if needed (silently, no status update)
            optimized_prompt = prompt
            if len(prompt) < 50 and self.ai_service:
                try:
                    optimized_prompt = self.ai_service.optimize_prompt(prompt)
                    logger.info(f"Prompt optimized: {prompt[:50]}... -> {optimized_prompt[:50]}...")
                except Exception as e:
                    logger.error(f"Error optimizing prompt: {str(e)}")
                    # Continue with original prompt
            
            # Thread 1: AI generation -> Building project (sequential)
            ai_and_build_thread = threading.Thread(
                target=self._ai_generation_and_build_parallel,
                args=(project_id, project_dir, optimized_prompt, is_new_project, sid)
            )
            ai_and_build_thread.daemon = True
            ai_and_build_thread.start()
            
            # Thread 2: Writing files (runs in parallel with thread 1)
            write_files_thread = threading.Thread(
                target=self._write_files_parallel,
                args=(project_id, project_dir, sid)
            )
            write_files_thread.daemon = True
            write_files_thread.start()
            
            # Wait for both threads to complete
            ai_and_build_thread.join()
            write_files_thread.join()
            
            # Clean up events
            if project_id in self._building_started_events:
                del self._building_started_events[project_id]
            if project_id in self._streaming_stopped_events:
                del self._streaming_stopped_events[project_id]
            if project_id in self._ai_generation_complete_events:
                del self._ai_generation_complete_events[project_id]
            if project_id in self._streaming_complete_events:
                del self._streaming_complete_events[project_id]
            
            if self._check_cancelled(project_id):
                return
            
            # Note: Completion is handled in _build_and_upload_parallel after both threads finish
            
        except Exception as e:
            logger.error(f"Error in project generation: {str(e)}")
            # Ensure project_id is defined for error reporting (it should be from args, but just in case)
            current_project_id = project_id if 'project_id' in locals() else "unknown"
            
            self.state_manager.update_state(current_project_id, {
                'status': 'error',
                'error': str(e)
            })
            # Update PocketBase status to error
            self.pocketbase_service.update_project_status(current_project_id, 'error')
            self.socketio.emit('project_error', {
                'project_id': current_project_id,
                'error': str(e)
            }, room=f"project:{current_project_id}")
    
    def _clone_repository(self, project_id: str, project_dir: Path, sid: str) -> bool:
        """Clone repository to project directory"""
        try:
            if os.path.exists(project_dir):
                shutil.rmtree(project_dir)
            
            project_dir.mkdir(parents=True, exist_ok=True)
            
            # Get GitHub token from environment
            github_token = os.getenv('GITHUB_TOKEN')
            
            # Prepare repository URL with token if provided
            repo_url = self.repo_url
            if github_token:
                # Handle different URL formats
                if repo_url.startswith('https://github.com/'):
                    # Insert token into HTTPS URL
                    repo_url = repo_url.replace('https://', f'https://{github_token}@')
                elif repo_url.startswith('git@github.com:'):
                    # For SSH, we'd need to use SSH keys, but for now support HTTPS with token
                    # Convert SSH format to HTTPS
                    repo_url = repo_url.replace('git@github.com:', 'https://github.com/')
                    repo_url = repo_url.replace('https://', f'https://{github_token}@')
            
            Repo.clone_from(repo_url, str(project_dir), branch=self.repo_branch)
            logger.info(f"Cloned repository to {project_dir}")
            return True
        except Exception as e:
            logger.error(f"Error cloning repository: {str(e)}")
            self.socketio.emit('error', {
                'message': f'Failed to clone repository: {str(e)}'
            }, room=f"project:{project_id}")
            return False
    
    def _download_project(self, project_id: str, project_dir: Path, sid: str) -> bool:
        """Download project from R2"""
        try:
            # Download source folder
            source_prefix = f"{project_id}/source"
            downloaded = self.r2_service.download_directory(source_prefix, str(project_dir))
            
            if not downloaded:
                logger.warning(f"No files downloaded for {project_id}")
                return False
            
            logger.info(f"Downloaded {len(downloaded)} files for {project_id}")
            return True
        except Exception as e:
            logger.error(f"Error downloading project: {str(e)}")
            self.socketio.emit('error', {
                'message': f'Failed to download project: {str(e)}'
            }, room=f"project:{project_id}")
            return False
    
    def _generate_files(self, project_id: str, project_dir: Path, prompt: str, 
                       is_new_project: bool, sid: str) -> bool:
        """Generate/modify files based on prompt"""
        # TODO: Integrate AI service here
        # This method should:
        # 1. Call your AI service (OpenAI, Anthropic, etc.) with the prompt
        # 2. Get the generated/modified file contents
        # 3. Write the files to the project directory
        # 4. Stream the files as they are created/modified
        # 
        # Example AI integration:
        ai_service = AIService()
        files_to_generate = ai_service.generate_files(prompt, project_dir, is_new_project)
        for file_path, content in files_to_generate:
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, 'w') as f:
                f.write(content)
            streaming_service.stream_file(file_path, project_id, sid, 3)
        #
        # For now, we'll stream existing files to demonstrate the workflow
        
        # Import here to avoid circular dependency
        from services.streaming_service import StreamingService
        streaming_service = StreamingService(self.socketio, self.cancelled_projects)
        
        # Get all files in project
        files = []
        priority_files = []  # Files to show last (App.tsx, index.html, App.css)
        
        # Files and patterns to skip
        skip_patterns = [
            'node_modules', '.git', 'dist', '.next', 
            'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
            '.DS_Store', 'Thumbs.db', '.env.local', '.env',
            'chat.json','components/ui'
        ]
        
        # Priority files that should be shown last
        priority_patterns = ['App.tsx', 'App.jsx', 'index.html', 'App.css', 'index.css']
        
        # Helper to check if file is binary
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
                
                # Skip files matching skip patterns
                if any(skip in file_str for skip in skip_patterns):
                    continue
                
                # Skip binary files
                if is_binary_file(file_path):
                    continue
                
                # Check if it's a priority file (to show last)
                file_name = file_path.name
                if any(priority in file_name for priority in priority_patterns):
                    priority_files.append(str(file_path))
                else:
                    files.append(str(file_path))
        
        # Add priority files at the end
        files.extend(priority_files)
        
        # Stream files one at a time, completing each before starting the next
        file_count = 0
        for file_path in files:
            if self._check_cancelled(project_id):
                return False
            
            file_count += 1
            logger.info(f"Starting to stream file {file_count}/{len(files)}: {file_path}")
            
            # Stream file completely before moving to next (this is blocking)
            # The stream_file method will calculate and wait for animation time internally
            streaming_service.stream_file(file_path, project_id, sid, 3)
            
            # Small buffer to ensure frontend has processed file_end event
            time.sleep(0.1)
            
            logger.info(f"Completed streaming file {file_count}/{len(files)}: {file_path}")
            
            # Update file list in state
            # Get relative path from project directory (already relative, no output prefix)
            relative_path = str(Path(file_path).relative_to(project_dir))
            # Normalize path separators
            relative_path = relative_path.replace('\\', '/')
            state = self.state_manager.get_state(project_id)
            files_list = state.get('files', [])
            if relative_path not in files_list:
                files_list.append(relative_path)
                self.state_manager.update_state(project_id, {'files': files_list})
        
        # Add to chat history
        state = self.state_manager.get_state(project_id)
        chat_history = state.get('chat_history', [])
        chat_history.append({
            'step': 3,
            'action': 'generated_files',
            'file_count': file_count,
            'timestamp': time.time()
        })
        self.state_manager.update_state(project_id, {'chat_history': chat_history})
        
        return True
    
    def _ai_generation_and_build_parallel(self, project_id: str, project_dir: Path, prompt: str, 
                                          is_new_project: bool, sid: str):
        """Thread 1: AI generation -> Building project (sequential)"""
        packages_to_install = []  # Initialize to avoid NameError
        try:
            # Step 1: Run AI generation
            if self.ai_service:
                try:
                    def on_file_saved(files):
                        if project_id not in self.ai_processed_files:
                            self.ai_processed_files[project_id] = set()
                        # Use absolute paths for consistency
                        for f in files:
                            abs_path = str(project_dir / f.lstrip('/\\'))
                            self.ai_processed_files[project_id].add(abs_path)
                            logger.info(f"Marked {abs_path} as AI-processed")

                    # Run AI generation - it will continue even with errors
                    success, packages_to_install = self.ai_service.generate_project_iterative(
                        project_dir, 
                        prompt, 
                        is_new_project,
                        project_id,
                        self.socketio,
                        sid,
                        on_file_saved=on_file_saved
                    )
                    logger.info("AI generation completed (with possible errors, but continuing)")
                    if packages_to_install:
                        logger.info(f"Packages to install after generation: {', '.join(packages_to_install)}")
                except Exception as e:
                    logger.warning(f"AI generation encountered errors but continuing: {str(e)}")
                    # Continue anyway - don't stop the process
            else:
                logger.warning("AI service not available, skipping generation")
            
            # Signal that AI generation is complete (always, even if there were errors)
            if project_id in self._ai_generation_complete_events:
                self._ai_generation_complete_events[project_id].set()
            
            # Wait for file streaming to complete before starting the build
            if project_id in self._streaming_complete_events:
                logger.info(f"Waiting for file streaming to complete for {project_id}...")
                # Set a timeout to prevent indefinite waiting (e.g., 5 minutes)
                if self._streaming_complete_events[project_id].wait(timeout=300):
                    logger.info(f"File streaming completed for {project_id}.")
                else:
                    logger.warning(f"Timeout waiting for file streaming to complete for {project_id}.")

            # Step 2: Now build the project (after AI generation and streaming complete)
            if self._check_cancelled(project_id):
                return
            
            # Signal that building has started
            if project_id in self._building_started_events:
                self._building_started_events[project_id].set()
                logger.info(f"Building started for {project_id}")
            
            # Step 4: Finalizing
            self._emit_status(project_id, 4, "Finalizing project structure", sid)
            time.sleep(0.5)
            
            if self._check_cancelled(project_id):
                return
            
            # Install dependencies (silently, no status update)
            if not self._install_dependencies(project_dir, project_id, sid, packages_to_install):
                logger.error("Failed to install dependencies")
                self.state_manager.update_state(project_id, {
                    'status': 'error',
                    'error': 'Failed to install dependencies'
                })
                self.pocketbase_service.update_project_status(project_id, 'error')
                return
            
            if self._check_cancelled(project_id):
                return
            
            # Step 5: Build project with retry logic
            self._emit_status(project_id, 5, "Building the project", sid)
            build_success = False
            for retry in range(self.build_max_retries):
                if self._build_project(project_dir, project_id, sid):
                    build_success = True
                    break
                else:
                    if retry < self.build_max_retries - 1:
                        # Try to fix with AI (silently, no status update)
                        if self.ai_service:
                            # Get last build error from state
                            state = self.state_manager.get_state(project_id) or {}
                            build_error = state.get('last_build_error', 'Build failed')
                            
                            # Get current file list for context
                            files_list = state.get('files', [])
                            
                            fix_suggestion = self.ai_service.fix_build_errors(
                                project_dir, 
                                build_error, 
                                project_id, 
                                self.socketio, 
                                sid,
                                files=files_list
                            )
                            
                            if fix_suggestion:
                                logger.info(f"AI suggested fix: {fix_suggestion[:200]}...")
                                
                                # Store fix suggestion in state for debugging
                                self.state_manager.update_state(project_id, {
                                    'last_fix_suggestion': fix_suggestion
                                })
                                
                                # 1. Extract and install any new packages
                                new_packages = self.ai_service._extract_packages_to_install(fix_suggestion)
                                if new_packages:
                                    logger.info(f"Installing new packages suggested by AI: {new_packages}")
                                    self._install_dependencies(project_dir, project_id, sid, new_packages)
                                
                                # 2. Extract and apply code changes
                                saved_files, _ = CodeExtractor.extract_and_save(fix_suggestion, project_dir, save_partial=True, skip_system_files=False)
                                if saved_files:
                                    logger.info(f"Applied fixes to {len(saved_files)} files: {saved_files}")
                                    
                                    # 3. Re-ensure build configuration in case AI changed it
                                    try:
                                        self.ai_service._ensure_build_configuration(project_dir)
                                    except Exception as config_err:
                                        logger.warning(f"Error re-ensuring build config after fix: {str(config_err)}")
                                        
                                    # Update state with new/modified files
                                    state = self.state_manager.get_state(project_id) or {}
                                    files_list = state.get('files', [])
                                    for f in saved_files:
                                        if f not in files_list:
                                            files_list.append(f)
                                    self.state_manager.update_state(project_id, {'files': files_list})
                                else:
                                    logger.warning("AI suggested a fix but no code blocks were extracted.")
                        time.sleep(2)  # Wait before retry
            
            if not build_success:
                logger.error("Build failed after all retries")
                self.state_manager.update_state(project_id, {
                    'status': 'error',
                    'error': 'Build failed after retries'
                })
                self.pocketbase_service.update_project_status(project_id, 'error')
                return
            
            if self._check_cancelled(project_id):
                return
            
            # Step 6: Upload to cloud
            self._emit_status(project_id, 6, "Uploading to the cloud", sid)
            if not self._upload_project(project_id, project_dir, sid):
                return
            
            # Save chat.json before completion
            self._save_chat_json(project_id, project_dir)
            
            # Step 7: Complete
            self._emit_status(project_id, 7, "Project generation completed", sid)
            self.state_manager.update_state(project_id, {
                'status': 'completed',
                'completed_at': time.time()
            })
            
            # Update PocketBase status to completed
            self.pocketbase_service.update_project_status(project_id, 'completed')
            
            # Send updated chat data with all steps
            chat_data = self.get_chat_data(project_id)
            self.socketio.emit('chat_data', chat_data, room=f"project:{project_id}")
            
            self.socketio.emit('project_completed', {'project_id': project_id}, room=f"project:{project_id}")
            
        except Exception as e:
            logger.error(f"Error in AI generation and build: {str(e)}")
            self.state_manager.update_state(project_id, {
                'status': 'error',
                'error': str(e)
            })
            # Update PocketBase status to error
            self.pocketbase_service.update_project_status(project_id, 'error')
            self.socketio.emit('project_error', {
                'project_id': project_id,
                'error': str(e)
            }, room=f"project:{project_id}")
            # Signal completion even on error
            if project_id in self._ai_generation_complete_events:
                self._ai_generation_complete_events[project_id].set()
    
    def _write_files_parallel(self, project_id: str, project_dir: Path, sid: str):
        """Thread 2: Writing/streaming files (runs in parallel with AI generation)"""
        try:
            # Import here to avoid circular dependency
            from services.streaming_service import StreamingService
            streaming_service = StreamingService(self.socketio, self.cancelled_projects)
            
            # Get template files snapshot for this project
            template_files = self.template_files.get(project_id, set())
            
            # Files and patterns to skip
            skip_patterns = [
                'node_modules', '.git', 'dist', '.next', 
                'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
                '.DS_Store', 'Thumbs.db', '.env.local', '.env',
                'chat.json','components/ui'
            ]
            
            # Priority patterns that should be shown last WITHIN their category
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
            
            # Keep checking for new files while AI is generating
            ai_complete = self._ai_generation_complete_events.get(project_id)
            streamed_as_template = set()
            streamed_as_iteration = set()
            
            # Stream files continuously until AI is done AND all files are streamed
            while True:
                if self._check_cancelled(project_id):
                    break
                
                # Get current AI-processed files
                ai_files = self.ai_processed_files.get(project_id, set())

                # Scan for all files currently in the directory
                found_files = []
                for file_path in project_dir.rglob('*'):
                    if file_path.is_file():
                        file_str = str(file_path)
                        if any(skip in file_str for skip in skip_patterns) or is_binary_file(file_path):
                            continue
                        found_files.append(file_str)

                # Identify files that need streaming
                # 1. Any AI-processed file not yet streamed as iteration
                iteration_queue = [f for f in found_files if f in ai_files and f not in streamed_as_iteration]
                
                # 2. Any template file not yet streamed AT ALL
                template_queue = [f for f in found_files if f in template_files and f not in iteration_queue and f not in streamed_as_template and f not in streamed_as_iteration]
                
                if iteration_queue or template_queue:
                    # Sort logic (priority patterns last)
                    def sort_key(f):
                        name = os.path.basename(f)
                        if any(priority in name for priority in priority_patterns):
                            return (1, name)
                        return (0, name)
                    
                    iteration_queue.sort(key=sort_key)
                    template_queue.sort(key=sort_key)
                    
                    # Next file to stream
                    next_file = None
                    is_iteration = False
                    
                    if iteration_queue:
                        next_file = iteration_queue[0]
                        is_iteration = True
                    else:
                        next_file = template_queue[0]
                        is_iteration = False
                    
                    if next_file:
                        logger.info(f"Streaming {'iteration' if is_iteration else 'template'} file: {next_file}")
                        
                        files_streamed_count = len(streamed_as_template) + len(streamed_as_iteration)
                        stream_characters = files_streamed_count < 5
                        
                        # Stream file
                        streaming_service.stream_file(next_file, project_id, sid, 3, stream_characters=stream_characters)
                        
                        if is_iteration:
                            streamed_as_iteration.add(next_file)
                        else:
                            streamed_as_template.add(next_file)
                        
                        # Update file list in state
                        relative_path = str(Path(next_file).relative_to(project_dir))
                        relative_path = relative_path.replace('\\', '/')
                        state = self.state_manager.get_state(project_id)
                        files_list = state.get('files', [])
                        if relative_path not in files_list:
                            files_list.append(relative_path)
                            self.state_manager.update_state(project_id, {'files': files_list})
                        
                        continue
                
                # Check for completion
                if ai_complete and ai_complete.is_set():
                    # Check if there are truly no more files
                    # Re-scan one last time
                    ai_files = self.ai_processed_files.get(project_id, set())
                    remaining = False
                    for file_path in project_dir.rglob('*'):
                        if file_path.is_file():
                            f_str = str(file_path)
                            if any(skip in f_str for skip in skip_patterns) or is_binary_file(file_path):
                                continue
                            if f_str in ai_files:
                                if f_str not in streamed_as_iteration:
                                    remaining = True
                                    break
                            elif f_str in template_files:
                                if f_str not in streamed_as_template and f_str not in streamed_as_iteration:
                                    remaining = True
                                    break
                    
                    if not remaining:
                        logger.info(f"No more files to stream for {project_id}. Breaking loop.")
                        break
                
                time.sleep(0.1)
            
            # After all files are written, ensure we move to step 4 status if not already moved
            # This marks step 3 as completed (tick) in the UI


                
            # Update chat history
            streamed_files = streamed_as_template.union(streamed_as_iteration)
            state = self.state_manager.get_state(project_id)
            chat_history = state.get('chat_history', [])
            chat_history.append({
                'step': 3,
                'action': 'generated_files',
                'file_count': len(streamed_files),
                'timestamp': time.time()
            })
            self.state_manager.update_state(project_id, {'chat_history': chat_history})
            
            # Signal that streaming is completely finished for this project
            if project_id in self._streaming_complete_events:
                self._streaming_complete_events[project_id].set()
            
            logger.info(f"Step 3 Streaming complete for {project_id}")
            
        except Exception as e:
            logger.error(f"Error in file writing: {str(e)}")
            # Ensure we signal completion even on error to avoid deadlocking Thread 1
            if project_id in self._streaming_complete_events:
                self._streaming_complete_events[project_id].set()
    
    
    def _build_and_upload_parallel(self, project_id: str, project_dir: Path, sid: str):
        """Build and upload in parallel thread - waits for AI generation to complete"""
        try:
            # Wait for AI generation to complete
            ai_complete_event = self._ai_generation_complete_events.get(project_id)
            if ai_complete_event:
                logger.info(f"Waiting for AI generation to complete for project {project_id}")
                # Wait with timeout (max 30 minutes)
                ai_complete_event.wait(timeout=1800)
                logger.info(f"AI generation completed for project {project_id}")
            else:
                logger.warning(f"No AI completion event found for {project_id}, proceeding anyway")
                time.sleep(2)  # Small delay if event not found
            
            if self._check_cancelled(project_id):
                return
            
            # Wait a bit for streaming to stop
            time.sleep(0.5)
            
            # Step 4: Finalizing
            self._emit_status(project_id, 4, "Finalizing project structure", sid)
            time.sleep(0.5)
            
            if self._check_cancelled(project_id):
                return
            
            # Install dependencies (silently, no status update)
            if not self._install_dependencies(project_dir, project_id, sid, []):
                logger.error("Failed to install dependencies")
                self.state_manager.update_state(project_id, {
                    'status': 'error',
                    'error': 'Failed to install dependencies'
                })
                self.pocketbase_service.update_project_status(project_id, 'error')
                return
            
            if self._check_cancelled(project_id):
                return
            
            # Step 5: Build project with retry logic
            self._emit_status(project_id, 5, "Building the project", sid)
            build_success = False
            for retry in range(self.build_max_retries):
                if self._build_project(project_dir, project_id, sid):
                    build_success = True
                    break
                else:
                    if retry < self.build_max_retries - 1:
                        # Try to fix with AI (silently, no status update)
                        if self.ai_service:
                            # Get last build error from state
                            state = self.state_manager.get_state(project_id) or {}
                            build_error = state.get('last_build_error', 'Build failed')
                            fix_suggestion = self.ai_service.fix_build_errors(
                                project_dir, 
                                build_error, 
                                project_id, 
                                self.socketio, 
                                sid
                            )
                            if fix_suggestion:
                                logger.info(f"AI suggested fix: {fix_suggestion[:200]}...")
                                # In a full implementation, you'd apply the fix here
                                # For now, we'll just retry
                        time.sleep(2)  # Wait before retry
            
            if not build_success:
                logger.error("Build failed after all retries")
                self.state_manager.update_state(project_id, {
                    'status': 'error',
                    'error': 'Build failed after retries'
                })
                self.pocketbase_service.update_project_status(project_id, 'error')
                return
            
            if self._check_cancelled(project_id):
                return
            
            # Step 6: Upload to cloud
            self._emit_status(project_id, 6, "Uploading to the cloud", sid)
            if not self._upload_project(project_id, project_dir, sid):
                return
            
            # Save chat.json before completion
            self._save_chat_json(project_id, project_dir)
            
            # Step 7: Complete
            self._emit_status(project_id, 7, "Project generation completed", sid)
            self.state_manager.update_state(project_id, {
                'status': 'completed',
                'completed_at': time.time()
            })
            
            # Update PocketBase status to completed
            self.pocketbase_service.update_project_status(project_id, 'completed')
            
            # Send updated chat data with all steps
            chat_data = self.get_chat_data(project_id)
            self.socketio.emit('chat_data', chat_data, room=f"project:{project_id}")
            
            self.socketio.emit('project_completed', {'project_id': project_id}, room=f"project:{project_id}")
            
        except Exception as e:
            logger.error(f"Error in parallel build and upload: {str(e)}")
            self.state_manager.update_state(project_id, {
                'status': 'error',
                'error': str(e)
            })
            # Update PocketBase status to error
            self.pocketbase_service.update_project_status(project_id, 'error')
            self.socketio.emit('project_error', {
                'project_id': project_id,
                'error': str(e)
            }, room=f"project:{project_id}")
    
    def _install_dependencies(self, project_dir: Path, project_id: str, sid: str, packages_to_install: List[str] = None) -> bool:
        """Install project dependencies using npm with cache, then install additional packages if needed"""
        if packages_to_install is None:
            packages_to_install = []
        
        try:
            # Determine npm command based on OS
            is_windows = os.name == 'nt'
            npm_cmd = 'npm.cmd' if is_windows else 'npm'
            
            logger.info("Installing dependencies with cache...")
            install_result = subprocess.run(
                [npm_cmd, 'install', '--prefer-offline', '--no-audit'],
                cwd=str(project_dir),
                capture_output=True,
                text=True,
                timeout=600,
                shell=is_windows
            )
            
            if install_result.returncode != 0:
                logger.error(f"npm install failed: {install_result.stderr}")
                self.socketio.emit('build_error', {
                    'message': f'npm install failed: {install_result.stderr}'
                }, room=f"project:{project_id}")
                return False
            
            logger.info("Dependencies installed successfully")
            
            # Install additional packages if provided
            if packages_to_install:
                logger.info(f"Installing additional packages: {', '.join(packages_to_install)}")
                install_packages_result = subprocess.run(
                    [npm_cmd, 'install', '--save'] + packages_to_install,
                    cwd=str(project_dir),
                    capture_output=True,
                    text=True,
                    timeout=600,
                    shell=is_windows
                )
                
                if install_packages_result.returncode != 0:
                    logger.error(f"Failed to install additional packages: {install_packages_result.stderr}")
                    self.socketio.emit('build_error', {
                        'message': f'Failed to install packages {packages_to_install}: {install_packages_result.stderr}'
                    }, room=f"project:{project_id}")
                    return False
                
                logger.info(f"Successfully installed packages: {', '.join(packages_to_install)}")
            
            return True
            
        except subprocess.TimeoutExpired:
            logger.error("Dependency installation timed out")
            self.socketio.emit('build_error', {
                'message': 'Dependency installation timed out'
            }, room=f"project:{project_id}")
            return False
        except Exception as e:
            logger.error(f"Error installing dependencies: {str(e)}")
            self.socketio.emit('build_error', {
                'message': f'Dependency installation error: {str(e)}'
            }, room=f"project:{project_id}")
            return False
    
    def _build_project(self, project_dir: Path, project_id: str, sid: str) -> bool:
        """Build the project using npm"""
        try:
            # Pre-build validation: ensure configuration is correct
            if self.ai_service:
                try:
                    logger.info("Running pre-build configuration validation...")
                    self.ai_service._ensure_build_configuration(project_dir)
                    logger.info("Pre-build validation completed")
                except Exception as validation_error:
                    logger.warning(f"Pre-build validation encountered issues: {str(validation_error)}")
                    # Continue anyway - the build might still work
            
            # Determine npm command based on OS
            is_windows = os.name == 'nt'
            npm_cmd = 'npm.cmd' if is_windows else 'npm'
            
            # Build project
            logger.info("Building project...")
            build_result = subprocess.run(
                [npm_cmd, 'run', 'build'],
                cwd=str(project_dir),
                capture_output=True,
                text=True,
                timeout=600,
                shell=is_windows
            )
            
            if build_result.returncode != 0:
                error_message = f"npm run build failed:\n{build_result.stderr}\n{build_result.stdout}"
                logger.error(error_message)
                
                # Store build error in state for AI fix
                self.state_manager.update_state(project_id, {
                    'last_build_error': error_message
                })
                
                self.socketio.emit('build_error', {
                    'message': error_message
                }, room=f"project:{project_id}")
                return False
            
            logger.info("Build completed successfully")
            return True
            
        except subprocess.TimeoutExpired:
            logger.error("Build process timed out")
            error_message = "Build process timed out"
            
            # Store build error
            self.state_manager.update_state(project_id, {
                'last_build_error': error_message
            })
            
            self.socketio.emit('build_error', {
                'message': error_message
            }, room=f"project:{project_id}")
            return False
        except Exception as e:
            logger.error(f"Error building project: {str(e)}")
            error_message = f'Build error: {str(e)}'
            
            # Store build error
            self.state_manager.update_state(project_id, {
                'last_build_error': error_message
            })
            
            self.socketio.emit('build_error', {
                'message': error_message
            }, room=f"project:{project_id}")
            return False
    
    def _upload_project(self, project_id: str, project_dir: Path, sid: str) -> bool:
        """Upload project to R2"""
        try:
            # Upload dist folder if it exists (from build)
            dist_dir = project_dir / 'dist'
            uploaded_dist = []
            
            if dist_dir.exists():
                dist_prefix = f"{project_id}/dist"
                uploaded_dist = self.r2_service.upload_directory(str(dist_dir), dist_prefix)
                logger.info(f"Uploaded {len(uploaded_dist)} files to dist folder")
            else:
                # No dist folder (build skipped), upload source files as dist
                logger.info("No dist folder found, uploading source files as dist")
                for file_path in project_dir.rglob('*'):
                    if file_path.is_file():
                        skip_dirs = ['node_modules', '.git', '.next', '__pycache__']
                        skip_files = ['package-lock.json', 'yarn.lock', '.DS_Store']
                        
                        if any(skip in str(file_path) for skip in skip_dirs):
                            continue
                        if file_path.name in skip_files:
                            continue
                        
                        relative_path = file_path.relative_to(project_dir)
                        dist_key = f"{project_id}/dist/{relative_path}".replace('\\', '/')
                        
                        if self.r2_service.upload_file(str(file_path), dist_key):
                            uploaded_dist.append(dist_key)
                
                logger.info(f"Uploaded {len(uploaded_dist)} source files as dist")
            
            # Upload source folder (excluding dist, node_modules, .git)
            source_files = []
            for file_path in project_dir.rglob('*'):
                if file_path.is_file():
                    skip_dirs = ['node_modules', '.git', 'dist', '.next']
                    if any(skip in str(file_path) for skip in skip_dirs):
                        continue
                    
                    relative_path = file_path.relative_to(project_dir)
                    source_key = f"{project_id}/source/{relative_path}".replace('\\', '/')
                    
                    if self.r2_service.upload_file(str(file_path), source_key):
                        source_files.append(source_key)
            
            logger.info(f"Uploaded {len(source_files)} files to source folder")
            
            # Update state
            self.state_manager.update_state(project_id, {
                'uploaded_files': len(source_files),
                'dist_files': len(uploaded_dist)
            })
            
            return True
            
        except Exception as e:
            logger.error(f"Error uploading project: {str(e)}")
            self.socketio.emit('upload_error', {
                'message': f'Upload error: {str(e)}'
            }, room=f"project:{project_id}")
            return False
    
    def _save_chat_json(self, project_id: str, project_dir: Path = None):
        """Save chat data to chat.json file in project directory"""
        try:
            if project_id not in self.chat_data:
                return
            
            if project_dir is None:
                project_dir = self.output_dir / project_id.replace('/', '_')
            
            chat_file = project_dir / 'chat.json'
            chat_data_to_save = {
                'project_id': project_id,
                'messages': self.chat_data[project_id]['messages'],
                'steps': self.chat_data[project_id]['steps'],
                'last_updated': time.time()
            }
            
            with open(chat_file, 'w', encoding='utf-8') as f:
                json.dump(chat_data_to_save, f, indent=2, ensure_ascii=False)
            
            logger.info(f"Saved chat.json for {project_id}")
        except Exception as e:
            logger.error(f"Error saving chat.json: {str(e)}")
    
    def _load_chat_json(self, project_id: str, project_dir: Path, load_steps: bool = True):
        """Load chat data from chat.json file in project directory"""
        try:
            chat_file = project_dir / 'chat.json'
            if not chat_file.exists():
                # Initialize empty chat data if file doesn't exist
                self.chat_data[project_id] = {'messages': [], 'steps': []}
                return
            
            with open(chat_file, 'r', encoding='utf-8') as f:
                chat_data_loaded = json.load(f)
            
            # Merge with existing chat data
            if project_id not in self.chat_data:
                self.chat_data[project_id] = {'messages': [], 'steps': []}
            
            # Merge messages (avoid duplicates)
            existing_msgs = {(msg.get('content'), msg.get('timestamp')) for msg in self.chat_data[project_id]['messages']}
            for msg in chat_data_loaded.get('messages', []):
                msg_tuple = (msg.get('content'), msg.get('timestamp'))
                if msg_tuple not in existing_msgs:
                    self.chat_data[project_id]['messages'].append(msg)
                else:
                    logger.debug(f"Skipping duplicate message for {project_id}: {msg_tuple}")
            
            # Load steps from chat.json to show history ONLY if requested
            if load_steps:
                # Merge steps (avoid duplicates based on step number)
                existing_steps = {step.get('step') for step in self.chat_data[project_id]['steps']}
                for step in chat_data_loaded.get('steps', []):
                    if step.get('step') not in existing_steps:
                        self.chat_data[project_id]['steps'].append(step)
                
                # Sort steps by step number
                self.chat_data[project_id]['steps'].sort(key=lambda x: x.get('step', 0))
            
            logger.info(f"Loaded chat.json for {project_id}")
        except Exception as e:
            logger.error(f"Error loading chat.json: {str(e)}")
            # Initialize empty chat data on error
            if project_id not in self.chat_data:
                self.chat_data[project_id] = {'messages': [], 'steps': []}
    
    def get_chat_data(self, project_id: str) -> dict:
        """Get chat data for a project"""
        # If not in memory, try to load from disk
        if project_id not in self.chat_data:
            project_dir = self.output_dir / project_id.replace('/', '_')
            if project_dir.exists():
                self._load_chat_json(project_id, project_dir)
        
        return self.chat_data.get(project_id, {'messages': [], 'steps': []})
    
    def add_user_message(self, project_id: str, message: str):
        """Add a user message to chat data"""
        project_dir = self.output_dir / project_id.replace('/', '_')
        
        # Try to load existing history if not in memory
        if project_id not in self.chat_data:
            if project_dir.exists():
                self._load_chat_json(project_id, project_dir)
            else:
                self.chat_data[project_id] = {'messages': [], 'steps': []}
        
        # Archive previous steps if they exist
        if self.chat_data[project_id].get('steps'):
            previous_steps = self.chat_data[project_id]['steps']
            # Create a system message with these steps
            system_message = {
                'type': 'system',
                'content': 'Generation completed',
                'steps': previous_steps,
                'timestamp': time.time()
            }
            self.chat_data[project_id]['messages'].append(system_message)
            # Clear steps after archiving
            self.chat_data[project_id]['steps'] = []
            
        self.chat_data[project_id]['messages'].append({
            'type': 'user',
            'content': message,
            'timestamp': time.time()
        })
        
        # Save to file if project directory exists
        if project_dir.exists():
            self._save_chat_json(project_id, project_dir)
