import os
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

try:
    from pocketbase import PocketBase
    POCKETBASE_AVAILABLE = True
except ImportError:
    POCKETBASE_AVAILABLE = False
    PocketBase = None

logger = logging.getLogger(__name__)

class PocketBaseService:
    """Service for interacting with PocketBase API"""
    
    def __init__(self):
        self.base_url = os.getenv('POCKETBASE_URL', 'http://localhost:8090')
        self.admin_email = os.getenv('POCKETBASE_ADMIN_EMAIL')
        self.admin_password = os.getenv('POCKETBASE_ADMIN_PASSWORD')
        self._client = None
        self._authenticated = False
        
    def _get_client(self) -> Optional[Any]:
        """Get authenticated PocketBase client"""
        try:
            if not POCKETBASE_AVAILABLE:
                logger.warning("PocketBase SDK not available. Install with: pip install pocketbase")
                return None
            
            if self._client is None:
                self._client = PocketBase(self.base_url)
            
            # Authenticate if not already authenticated
            if not self._authenticated:
                if not self.admin_email or not self.admin_password:
                    logger.warning("PocketBase admin credentials not configured")
                    return None
                
                try:
                    self._client.admins.auth_with_password(self.admin_email, self.admin_password)
                    self._authenticated = True
                    logger.debug("Successfully authenticated with PocketBase")
                except Exception as e:
                    # Handle different exception types
                    error_msg = str(e)
                    if hasattr(e, 'status'):
                        error_msg = f"{e.status} - {error_msg}"
                    logger.error(f"PocketBase authentication failed: {error_msg}")
                    return None
            
            return self._client
                
        except Exception as e:
            logger.error(f"Error initializing PocketBase client: {str(e)}")
            return None
    
    def _is_pro_user(self, user_id: str) -> bool:
        """
        Check if user is on pro plan
        
        Args:
            user_id: User ID from PocketBase
            
        Returns:
            True if user is on pro plan, False otherwise
        """
        try:
            client = self._get_client()
            if not client:
                return False
            
            try:
                user = client.collection("users").get_one(user_id)
                # Check plan field - can be 'pro', 'Pro', or None/'free'
                plan = getattr(user, 'plan', None) if hasattr(user, 'plan') else (user.get('plan') if isinstance(user, dict) else None)
                is_pro = plan and (plan.lower() == 'pro' or plan == 'Pro')
                logger.debug(f"User {user_id} plan: {plan}, is_pro: {is_pro}")
                return is_pro
            except Exception as e:
                error_msg = str(e)
                if hasattr(e, 'status'):
                    error_msg = f"{e.status} - {error_msg}"
                logger.warning(f"Could not check user plan for {user_id}: {error_msg}")
                # Default to False (free plan) if we can't check
                return False
                
        except Exception as e:
            logger.error(f"Error checking user plan: {str(e)}")
            return False
    
    def _calculate_expiry_date(self, user_id: str) -> Optional[str]:
        """
        Calculate expiry date for project based on user's plan
        
        Args:
            user_id: User ID from PocketBase
            
        Returns:
            Expiry date as ISO format string (YYYY-MM-DD) if free plan, None if pro plan
        """
        try:
            is_pro = self._is_pro_user(user_id)
            
            if is_pro:
                # Pro plan users have no expiry
                return None
            else:
                # Free plan users: current date + 7 days
                expiry_date = datetime.now() + timedelta(days=7)
                return expiry_date.strftime('%Y-%m-%d')
                
        except Exception as e:
            logger.error(f"Error calculating expiry date: {str(e)}")
            # Default to 7 days if there's an error
            expiry_date = datetime.now() + timedelta(days=7)
            return expiry_date.strftime('%Y-%m-%d')
    
    def create_or_update_project(self, project_id: str, username: str, project_name: str, 
                                 status: str, is_new_project: bool = True, visibility: str = "public") -> Optional[str]:
        """
        Create or update a project in PocketBase
        
        Args:
            project_id: Format "username/project_name"
            username: User ID from PocketBase
            project_name: Name of the project
            status: Project status (generating, modifying, building, uploading, completed, error, cancelled)
            is_new_project: Whether this is a new project or modification
            visibility: Project visibility ("public" or "private")
            
        Returns:
            Project record ID if successful, None otherwise
        """
        try:
            client = self._get_client()
            if not client:
                logger.warning("Could not authenticate with PocketBase, skipping project creation")
                return None
            
            # Determine status text
            status_text = "generating" if is_new_project else "modifying"
            if status in ["generating", "modifying", "building", "uploading", "completed", "error", "cancelled"]:
                status_text = status
            
            # Check if project already exists
            existing_project = self._find_project_by_name(username, project_name)
            
            if existing_project:
                # Update existing project - only update status, preserve expiry and visibility
                project_record_id = existing_project.get('id')
                update_data = {
                    "status": status_text
                }
                # Only update visibility if it's a new project creation (not a modification)
                if is_new_project:
                    update_data["visibility"] = visibility
                try:
                    updated_record = client.collection("projects").update(project_record_id, update_data)
                    logger.info(f"Updated project {project_id} in PocketBase with status {status_text}")
                    return updated_record.id if hasattr(updated_record, 'id') else project_record_id
                except Exception as e:
                    error_msg = str(e)
                    if hasattr(e, 'status'):
                        error_msg = f"{e.status} - {error_msg}"
                    logger.error(f"Failed to update project in PocketBase: {error_msg}")
                    return None
            else:
                # Create new project - set expiry based on user's plan
                expire_date = self._calculate_expiry_date(username)
                
                project_data = {
                    "name": project_name,
                    "user": username,
                    "status": status_text,
                    "deployed": False,
                    "visibility": visibility,  # Use provided visibility
                    "expire": expire_date if expire_date else ""  # Empty string if no expiry (pro plan)
                }
                
                try:
                    new_record = client.collection("projects").create(project_data)
                    logger.info(f"Created project {project_id} in PocketBase with status {status_text}, expire: {expire_date or 'never'}")
                    return new_record.id if hasattr(new_record, 'id') else None
                except Exception as e:
                    error_msg = str(e)
                    if hasattr(e, 'status'):
                        error_msg = f"{e.status} - {error_msg}"
                    logger.error(f"Failed to create project in PocketBase: {error_msg}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error creating/updating project in PocketBase: {str(e)}")
            return None
    
    def update_project_status(self, project_id: str, status: str) -> bool:
        """
        Update project status in PocketBase
        
        Args:
            project_id: Format "username/project_name"
            status: New status (generating, modifying, building, uploading, completed, error, cancelled)
            
        Returns:
            True if successful, False otherwise
        """
        try:
            client = self._get_client()
            if not client:
                logger.warning("Could not authenticate with PocketBase, skipping status update")
                return False
            
            # Parse project_id to get username and project_name
            parts = project_id.split('/')
            if len(parts) != 2:
                logger.error(f"Invalid project_id format: {project_id}")
                return False
            
            username, project_name = parts
            
            # Find existing project
            existing_project = self._find_project_by_name(username, project_name)
            if not existing_project:
                logger.warning(f"Project {project_id} not found in PocketBase, creating it")
                return self.create_or_update_project(project_id, username, project_name, status) is not None
            
            # Update status
            project_record_id = existing_project.get('id')
            try:
                client.collection("projects").update(project_record_id, {"status": status})
                logger.info(f"Updated project {project_id} status to {status} in PocketBase")
                return True
            except Exception as e:
                error_msg = str(e)
                if hasattr(e, 'status'):
                    error_msg = f"{e.status} - {error_msg}"
                logger.error(f"Failed to update project status in PocketBase: {error_msg}")
                return False
                
        except Exception as e:
            logger.error(f"Error updating project status in PocketBase: {str(e)}")
            return False
    
    def _find_project_by_name(self, username: str, project_name: str) -> Optional[Dict[str, Any]]:
        """Find a project by username and project name"""
        try:
            client = self._get_client()
            if not client:
                return None
            
            # Search for project by name and user
            filter_query = f'name="{project_name}" && user="{username}"'
            try:
                result = client.collection("projects").get_list(1, 1, {"filter": filter_query})
                if result.items and len(result.items) > 0:
                    # Convert record to dict
                    record = result.items[0]
                    # Handle both dict-like and object-like records
                    if hasattr(record, 'id'):
                        return {
                            'id': record.id,
                            'name': getattr(record, 'name', None),
                            'user': getattr(record, 'user', None),
                            'status': getattr(record, 'status', None),
                            'visibility': getattr(record, 'visibility', 'public'),
                        }
                    else:
                        # If it's already a dict
                        return {
                            **record,
                            'visibility': record.get('visibility', 'public')
                        }
            except Exception as e:
                error_msg = str(e)
                if hasattr(e, 'status'):
                    error_msg = f"{e.status} - {error_msg}"
                logger.debug(f"No project found matching filter: {error_msg}")
            
            return None
            
        except Exception as e:
            logger.error(f"Error finding project in PocketBase: {str(e)}")
            return None
    
    def update_project_visibility(self, project_id: str, visibility: str) -> bool:
        """
        Update project visibility in PocketBase
        
        Args:
            project_id: Format "username/project_name"
            visibility: Project visibility ("public" or "private")
            
        Returns:
            True if successful, False otherwise
        """
        try:
            client = self._get_client()
            if not client:
                logger.warning("Could not authenticate with PocketBase, skipping visibility update")
                return False
            
            # Parse project_id to get username and project_name
            parts = project_id.split('/')
            if len(parts) != 2:
                logger.error(f"Invalid project_id format: {project_id}")
                return False
            
            username, project_name = parts
            
            # Find existing project
            existing_project = self._find_project_by_name(username, project_name)
            if not existing_project:
                logger.warning(f"Project {project_id} not found in PocketBase")
                return False
            
            # Update visibility
            project_record_id = existing_project.get('id')
            try:
                client.collection("projects").update(project_record_id, {"visibility": visibility})
                logger.info(f"Updated project {project_id} visibility to {visibility} in PocketBase")
                return True
            except Exception as e:
                error_msg = str(e)
                if hasattr(e, 'status'):
                    error_msg = f"{e.status} - {error_msg}"
                logger.error(f"Failed to update project visibility in PocketBase: {error_msg}")
                return False
                
        except Exception as e:
            logger.error(f"Error updating project visibility in PocketBase: {str(e)}")
            return False

