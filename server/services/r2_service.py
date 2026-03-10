import os
import boto3
from botocore.config import Config
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class R2Service:
    """Service for interacting with Cloudflare R2 storage"""
    
    def __init__(self):
        self.account_id = os.getenv('R2_ACCOUNT_ID')
        self.access_key_id = os.getenv('R2_ACCESS_KEY_ID')
        self.secret_access_key = os.getenv('R2_SECRET_ACCESS_KEY')
        self.bucket_name = os.getenv('R2_BUCKET_NAME')
        self.endpoint_url = os.getenv('R2_ENDPOINT_URL')
        
        # Configure boto3 for R2
        config = Config(
            region_name='auto',
            retries={
                'max_attempts': 3,
                'mode': 'standard'
            }
        )
        
        self.s3_client = boto3.client(
            's3',
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.access_key_id,
            aws_secret_access_key=self.secret_access_key,
            config=config
        )
    
    def upload_file(self, local_path: str, r2_key: str):
        """Upload a file to R2"""
        try:
            with open(local_path, 'rb') as f:
                self.s3_client.upload_fileobj(f, self.bucket_name, r2_key)
            logger.info(f"Uploaded {local_path} to {r2_key}")
            return True
        except Exception as e:
            logger.error(f"Error uploading file {local_path} to {r2_key}: {str(e)}")
            return False
    
    def upload_directory(self, local_dir: str, r2_prefix: str):
        """Upload a directory recursively to R2"""
        local_path = Path(local_dir)
        uploaded_files = []
        
        for file_path in local_path.rglob('*'):
            if file_path.is_file():
                relative_path = file_path.relative_to(local_path)
                r2_key = f"{r2_prefix}/{relative_path}".replace('\\', '/')
                
                if self.upload_file(str(file_path), r2_key):
                    uploaded_files.append(r2_key)
        
        return uploaded_files
    
    def download_file(self, r2_key: str, local_path: str):
        """Download a file from R2"""
        try:
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, 'wb') as f:
                self.s3_client.download_fileobj(self.bucket_name, r2_key, f)
            logger.info(f"Downloaded {r2_key} to {local_path}")
            return True
        except Exception as e:
            logger.error(f"Error downloading file {r2_key} to {local_path}: {str(e)}")
            return False
    
    def download_directory(self, r2_prefix: str, local_dir: str):
        """Download a directory recursively from R2"""
        try:
            os.makedirs(local_dir, exist_ok=True)
            
            # List all objects with the prefix
            paginator = self.s3_client.get_paginator('list_objects_v2')
            pages = paginator.paginate(Bucket=self.bucket_name, Prefix=r2_prefix)
            
            downloaded_files = []
            for page in pages:
                if 'Contents' in page:
                    for obj in page['Contents']:
                        r2_key = obj['Key']
                        # Get relative path
                        relative_path = r2_key[len(r2_prefix):].lstrip('/')
                        local_path = os.path.join(local_dir, relative_path)
                        
                        if self.download_file(r2_key, local_path):
                            downloaded_files.append(local_path)
            
            return downloaded_files
        except Exception as e:
            logger.error(f"Error downloading directory {r2_prefix}: {str(e)}")
            return []
    
    def upload_chat_json(self, project_id: str, chat_data: dict):
        """Upload chat.json to R2 (not in dist or source)"""
        import json
        import tempfile
        
        try:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                json.dump(chat_data, f, indent=2)
                temp_path = f.name
            
            r2_key = f"{project_id}/chat.json"
            success = self.upload_file(temp_path, r2_key)
            os.unlink(temp_path)
            return success
        except Exception as e:
            logger.error(f"Error uploading chat.json: {str(e)}")
            return False
    
    def project_exists(self, project_id: str) -> bool:
        """Check if project exists in R2"""
        try:
            # Check if source folder exists
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=f"{project_id}/source/",
                MaxKeys=1
            )
            return 'Contents' in response and len(response['Contents']) > 0
        except Exception as e:
            logger.error(f"Error checking project existence: {str(e)}")
            return False

