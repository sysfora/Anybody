import os
import json
import threading
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class StateManager:
    """Manages project state persistence"""
    
    def __init__(self):
        self.state_dir = Path(os.getenv('STATE_DIR', 'states'))
        self.state_dir.mkdir(exist_ok=True)
        self.locks = {}  # Per-project locks
        self._lock = threading.Lock()
    
    def _get_lock(self, project_id: str):
        """Get or create a lock for a project"""
        with self._lock:
            if project_id not in self.locks:
                self.locks[project_id] = threading.Lock()
            return self.locks[project_id]
    
    def _get_state_file(self, project_id: str) -> Path:
        """Get state file path for a project"""
        safe_id = project_id.replace('/', '_').replace('\\', '_')
        return self.state_dir / f"{safe_id}.json"
    
    def get_state(self, project_id: str) -> dict:
        """Get project state"""
        state_file = self._get_state_file(project_id)
        if not state_file.exists():
            return None
        
        lock = self._get_lock(project_id)
        with lock:
            try:
                with open(state_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error reading state for {project_id}: {str(e)}")
                return None
    
    def update_state(self, project_id: str, updates: dict):
        """Update project state"""
        state_file = self._get_state_file(project_id)
        lock = self._get_lock(project_id)
        
        with lock:
            # Read existing state
            state = {}
            if state_file.exists():
                try:
                    with open(state_file, 'r') as f:
                        state = json.load(f)
                except Exception as e:
                    logger.error(f"Error reading state for update {project_id}: {str(e)}")
            
            # Update state
            state.update(updates)
            
            # Write back
            try:
                with open(state_file, 'w') as f:
                    json.dump(state, f, indent=2)
            except Exception as e:
                logger.error(f"Error writing state for {project_id}: {str(e)}")
    
    def delete_state(self, project_id: str):
        """Delete project state"""
        state_file = self._get_state_file(project_id)
        lock = self._get_lock(project_id)
        
        with lock:
            if state_file.exists():
                try:
                    state_file.unlink()
                except Exception as e:
                    logger.error(f"Error deleting state for {project_id}: {str(e)}")

