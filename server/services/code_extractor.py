import re
import os
import logging
from pathlib import Path
from typing import List, Dict, Tuple, Optional

logger = logging.getLogger(__name__)

class CodeExtractor:
    """Extracts code blocks from AI responses and saves them as files"""
    
    @staticmethod
    def parse_code_blocks_from_text(text: str) -> List[Tuple[str, str, bool]]:
        """
        Parse code blocks from assistant message text (like reference _ParseCodeBlocksFromText)
        Handles two formats:
        1. ```lang file="path/to/file" ... ```
        2. File: path/to/file\n```lang\n...\n```
        Returns list of (filePath, content, isComplete) tuples where isComplete indicates if block is complete
        """
        code_blocks = []
        
        if not text:
            return code_blocks
        
        # Pattern 1: ```lang file="path/to/file" format
        pattern1 = r'```(?:\w+)?\s+file=["\']([^"\']+)["\']'
        # Pattern 2: File: path\n format
        pattern2 = r'File:\s+([^\n]+)'
        
        # Find all code block starts (both formats)
        code_block_starts = []
        for match in re.finditer(pattern1, text):
            start_pos = match.start()
            file_path = match.group(1)
            code_block_starts.append((start_pos, file_path, 'format1'))
        
        for match in re.finditer(pattern2, text):
            start_pos = match.start()
            file_path = match.group(1).strip()
            code_block_starts.append((start_pos, file_path, 'format2'))
        
        # Sort by position
        code_block_starts.sort(key=lambda x: x[0])
        
        # Process each code block start
        for i, (start_pos, file_path, format_type) in enumerate(code_block_starts):
            # Find the end position (start of next block or end of text)
            end_pos = code_block_starts[i + 1][0] if i + 1 < len(code_block_starts) else len(text)
            
            # Extract the block text from start to end
            block_text = text[start_pos:end_pos]
            
            # Find the opening and content start based on format
            if format_type == 'format1':
                # Format: ```lang file="path"
                opening_match = re.search(pattern1, block_text)
                if not opening_match:
                    continue
                content_start = block_text.find('\n', opening_match.end())
                if content_start == -1:
                    content_start = opening_match.end()
                content_section = block_text[content_start + 1:]
            else:
                # Format: File: path\n...```lang\n...
                opening_match = re.search(pattern2, block_text)
                if not opening_match:
                    continue
                # Find the FIRST occurrence of ``` after the File: line
                code_block_start = block_text.find('```', opening_match.end())
                if code_block_start == -1:
                    continue
                # Find the newline after THAT ``` line
                content_start = block_text.find('\n', code_block_start)
                if content_start == -1:
                    content_start = code_block_start
                content_section = block_text[content_start + 1:]
            
            # Simple detection: look for closing ``` marker
            # Just search for \n```\n or \n``` at the end
            closing_match = re.search(r'\n```(?:\s|$|\n)', content_section)
            
            if closing_match:
                # Found closing ```
                content_end = closing_match.start()
                content = content_section[:content_end].strip()
                
                # Only skip if content is purely "existing code" comment or empty
                is_just_existing_code = content.strip().startswith('// ... existing code ...') and len(content.strip().split('\n')) <= 2
                
                if content and content.strip() and not is_just_existing_code:
                    # Block is complete if we found the closing ```
                    code_blocks.append((file_path, content, True))
            else:
                # No closing ``` found - this is an incomplete block
                content = content_section.strip()
                
                # For the last block in the text, it might be incomplete because of truncation
                # We still append it and mark as incomplete
                is_just_existing_code = content.startswith('// ... existing code ...') and len(content.split('\n')) <= 2
                
                if content and not is_just_existing_code:
                    # For incomplete blocks, we still want to keep the content we have
                    # but maybe strip it more carefully to avoid partial markers
                    code_blocks.append((file_path, content, False))  # Mark as incomplete
                    logger.info(f"⚠️  Detected incomplete code block for {file_path} (missing closing ```)")
        
        return code_blocks
    
    @staticmethod
    def has_incomplete_code_blocks(text_content: str) -> bool:
        """
        Check if text content has any incomplete code blocks (like reference _HasIncompleteCodeBlocks)
        Returns True if any code blocks are incomplete, False otherwise
        """
        if not text_content:
            return False
        
        code_blocks = CodeExtractor.parse_code_blocks_from_text(text_content)
        
        # Check if any blocks are incomplete
        for file_path, content, is_complete in code_blocks:
            if not is_complete:
                return True
        
        return False
    
    @staticmethod
    def extract_code_blocks(text: str, partial_blocks: Optional[Dict[str, Dict]] = None) -> Tuple[List[Dict[str, str]], Dict[str, Dict]]:
        """
        Extract code blocks from AI response text using parse_code_blocks_from_text (like reference)
        
        Args:
            text: AI response text containing code blocks
            partial_blocks: Dict of incomplete blocks from previous iterations {file_path: {lang, code}}
                           (kept for compatibility, but now we use accumulated text approach)
            
        Returns:
            Tuple of (complete_code_blocks, updated_partial_blocks)
        """
        # Use the reference parsing method
        parsed_blocks = CodeExtractor.parse_code_blocks_from_text(text)
        
        code_blocks = []
        updated_partial = {}
        
        for file_path, content, is_complete in parsed_blocks:
            logger.info(f"🔍 Evaluated block for {file_path}: complete={is_complete}, length={len(content)}")
            if is_complete:
                # Complete block - extract it
                code_blocks.append({
                    'file_path': file_path,
                    'lang': '',  # Lang not captured in parse_code_blocks_from_text
                    'code': content
                })
                logger.info(f"✅ Extracted complete code block: {file_path}")
            else:
                # Incomplete block - store for next iteration
                updated_partial[file_path] = {
                    'lang': '',
                    'code': content
                }
                logger.info(f"⏳ Detected incomplete code block: {file_path} (will wait for completion)")
        
        return code_blocks, updated_partial
    
    @staticmethod
    def save_code_blocks(code_blocks: List[Dict[str, str]], project_dir: Path, skip_system_files: bool = True) -> List[str]:
        """
        Save extracted code blocks to files in project directory.
        Skips configuration files that are managed by the system unless skip_system_files is False.
        
        Args:
            code_blocks: List of code blocks with file_path, lang, and code
            project_dir: Project root directory
            skip_system_files: If True, skip files in SKIP_FILES set.
            
        Returns:
            List of saved file paths (relative to project_dir)
        """
        # Files to skip - these are managed by the system or generated automatically
        SKIP_FILES = {
            'tsconfig.json',
            'tsconfig.app.json',
            'tsconfig.node.json',
            'vite.config.ts',
            'components.json',
            'eslint.config.js'
        }
        
        saved_files = []
        
        for block in code_blocks:
            try:
                file_path = block['file_path']
                code = block['code']
                
                # Normalize file path - remove leading slash if present
                if file_path.startswith('/'):
                    file_path = file_path[1:]
                
                # Get just the filename for comparison
                normalized_path = file_path.lower().replace('\\', '/')
                filename = Path(normalized_path).name
                
                # Skip configuration files that are managed by the system
                if skip_system_files and (filename in SKIP_FILES or normalized_path in [f.lower() for f in SKIP_FILES]):
                    logger.info(f"Skipping system-managed file: {file_path}")
                    continue
                
                # Create full path
                full_path = project_dir / file_path
                
                # Create parent directories if needed
                full_path.parent.mkdir(parents=True, exist_ok=True)
                
                # Write file
                with open(full_path, 'w', encoding='utf-8') as f:
                    f.write(code)
                
                # Get relative path for return
                relative_path = str(full_path.relative_to(project_dir))
                saved_files.append(relative_path)
                
                logger.info(f"Saved file: {relative_path} ({len(code)} chars)")
                
            except Exception as e:
                logger.error(f"Error saving code block to {block.get('file_path', 'unknown')}: {str(e)}")
                continue
        
        return saved_files
    
    @staticmethod
    def extract_and_save(text: str, project_dir: Path, partial_blocks: Optional[Dict[str, Dict]] = None, save_partial: bool = False, skip_system_files: bool = True) -> Tuple[List[str], Dict[str, Dict]]:
        """
        Extract code blocks from text and save them to project directory.
        Only saves complete blocks by default. Partial blocks are buffered until complete.
        
        Args:
            text: AI response text containing code blocks
            project_dir: Project root directory
            partial_blocks: Dict of incomplete blocks from previous iterations
            save_partial: If True, save partial blocks (e.g., when DONE marker found). Default False.
            skip_system_files: If True, skip system-managed files.
            
        Returns:
            Tuple of (saved_file_paths, updated_partial_blocks)
        """
        code_blocks, updated_partial = CodeExtractor.extract_code_blocks(text, partial_blocks)
        saved_files = []
        
        # Only save complete blocks
        if code_blocks:
            saved_files = CodeExtractor.save_code_blocks(code_blocks, project_dir, skip_system_files=skip_system_files)
            logger.info(f"Saved {len(saved_files)} complete code blocks")
        
        # Only save partial blocks if explicitly requested (e.g., when DONE marker found)
        if save_partial and updated_partial:
            saved_partial_files = []
            for file_path, partial_data in updated_partial.items():
                try:
                    normalized_path = file_path.lstrip('/')
                    full_path = project_dir / normalized_path
                    full_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(full_path, 'w', encoding='utf-8') as f:
                        f.write(partial_data['code'])
                    saved_partial_files.append(normalized_path)
                    logger.info(f"Saved incomplete file (DONE marker): {normalized_path}")
                except Exception as e:
                    logger.error(f"Error saving partial block {file_path}: {str(e)}")
            
            if saved_partial_files:
                saved_files.extend(saved_partial_files)
                # Clear partial blocks after saving
                updated_partial = {}
        
        return saved_files, updated_partial

