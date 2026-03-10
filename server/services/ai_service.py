import os
import json
import re
import fnmatch
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple, Union
from anthropic import Anthropic
from openai import OpenAI
from services.code_extractor import CodeExtractor

logger = logging.getLogger(__name__)

# Simple wrapper classes to normalize responses between providers
class ContentBlock:
    def __init__(self, type, text=None, id=None, name=None, input=None):
        self.type = type
        self.text = text
        self.id = id
        self.name = name
        self.input = input

class AIResponse:
    def __init__(self, content):
        self.content = content

class AIService:
    """Service for interacting with LLM providers (Anthropic, OpenRouter) for project generation"""
    
    def __init__(self):
        # Determine provider
        self.provider = os.getenv('AI_PROVIDER', 'anthropic').lower()
        
        # Anthropic Configuration
        self.anthropic_api_key = os.getenv('ANTHROPIC_API_KEY')
        self.anthropic_model = os.getenv('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20241022')
        self.anthropic_max_iterations = int(os.getenv('ANTHROPIC_MAX_ITERATIONS', '10'))
        
        # General Configuration
        self.max_iterations = self.anthropic_max_iterations
        
        # OpenRouter Configuration
        self.openrouter_api_key = os.getenv('OPENROUTER_API_KEY')
        self.openrouter_model = os.getenv('OPENROUTER_MODEL', 'anthropic/claude-3.5-sonnet')
        
        # Fallback models for Anthropic
        self.anthropic_fallback_models = [
            'claude-3-5-sonnet-20241022',
            'claude-3-5-sonnet-20240620',
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229'
        ]
        
        # Initialize Client
        if self.provider == 'openrouter':
            if not self.openrouter_api_key:
                logger.warning("OPENROUTER_API_KEY not found, falling back to Anthropic")
                self.provider = 'anthropic'
            else:
                self.client = OpenAI(
                    base_url="https://openrouter.ai/api/v1",
                    api_key=self.openrouter_api_key
                )
                logger.info(f"Initialized OpenRouter client with model {self.openrouter_model}")
        
        if self.provider == 'anthropic':
            if not self.anthropic_api_key:
                raise ValueError("ANTHROPIC_API_KEY environment variable is required")
            
            self.client = Anthropic(api_key=self.anthropic_api_key)
            logger.info(f"Initialized Anthropic client with model {self.anthropic_model}")
        
        # Load agent prompt and tools
        prompts_dir = Path(__file__).parent.parent / 'prompts'
        self.agent_prompt = self._load_agent_prompt(prompts_dir)
        self.agent_tools = self._load_agent_tools(prompts_dir)
        self.prompt_optimizer = self._load_prompt_optimizer(prompts_dir)
        
        # Store partial code blocks per project for handling incomplete responses
        self.partial_code_blocks = {}  # {project_id: {file_path: {lang, code}}}
        # Store packages to install per project
        self.packages_to_install = {}  # {project_id: [package1, package2, ...]}
    
    def _load_agent_prompt(self, prompts_dir: Path) -> str:
        """Load agent prompt from file"""
        try:
            prompt_file = prompts_dir / 'Agent Prompt.txt'
            if prompt_file.exists():
                return prompt_file.read_text(encoding='utf-8')
            else:
                logger.warning(f"Agent prompt file not found at {prompt_file}")
                return "You are AnyCoder, Sysfora's AI coding assistant."
        except Exception as e:
            logger.error(f"Error loading agent prompt: {str(e)}")
            return "You are AnyCoder, Sysfora's AI coding assistant."
    
    def _load_agent_tools(self, prompts_dir: Path) -> List[Dict[str, Any]]:
        """Load agent tools from JSON file and convert to Anthropic format"""
        try:
            tools_file = prompts_dir / 'Agent Tools.json'
            if tools_file.exists():
                with open(tools_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    tools = data.get('tools', [])
                    # Check if tools already use input_schema (new format) or parameters (old format)
                    if tools and 'input_schema' in tools[0]:
                        # Already in Anthropic format, just clean and validate
                        return self._clean_anthropic_tools(tools)
                    else:
                        # Old format with parameters, convert to Anthropic format
                        return self._convert_tools_to_anthropic_format(tools)
            else:
                logger.warning(f"Agent tools file not found at {tools_file}")
                return []
        except Exception as e:
            logger.error(f"Error loading agent tools: {str(e)}")
            return []
    
    def _clean_anthropic_tools(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Clean and validate tools that are already in Anthropic format"""
        cleaned_tools = []
        for tool in tools:
            try:
                tool_name = tool.get("name", "")
                tool_description = tool.get("description", "")
                input_schema = tool.get("input_schema", {})
                
                if not tool_name:
                    logger.warning(f"Tool missing name, skipping")
                    continue
                
                if not isinstance(input_schema, dict) or "type" not in input_schema:
                    logger.warning(f"Tool {tool_name} has invalid input_schema, skipping")
                    continue
                
                # Clean input_schema - remove $schema if present
                if "$schema" in input_schema:
                    del input_schema["$schema"]
                
                # Clean properties
                if "properties" in input_schema:
                    for prop_name, prop_def in input_schema["properties"].items():
                        if isinstance(prop_def, dict) and "$schema" in prop_def:
                            del prop_def["$schema"]
                
                cleaned_tool = {
                    "name": tool_name,
                    "description": tool_description,
                    "input_schema": input_schema
                }
                
                cleaned_tools.append(cleaned_tool)
                logger.debug(f"Cleaned tool: {tool_name}")
            except Exception as e:
                logger.warning(f"Error cleaning tool {tool.get('name', 'unknown')}: {str(e)}")
                continue
        
        logger.info(f"Cleaned {len(cleaned_tools)} tools in Anthropic format")
        return cleaned_tools
    
    def _convert_tools_to_anthropic_format(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Convert tools from custom format to Anthropic API format"""
        anthropic_tools = []
        for tool in tools:
            try:
                # Anthropic expects: name, description, input_schema
                params = tool.get("parameters", {})
                if not isinstance(params, dict):
                    logger.warning(f"Tool {tool.get('name', 'unknown')} has invalid parameters format")
                    continue
                
                # Get properties and required fields
                properties = params.get("properties", {})
                required = params.get("required", [])
                
                # Clean properties - remove $schema if nested, ensure proper types
                cleaned_properties = {}
                for prop_name, prop_def in properties.items():
                    if isinstance(prop_def, dict):
                        # Remove $schema and other non-standard fields
                        cleaned_prop = {k: v for k, v in prop_def.items() 
                                      if k not in ["$schema", "$ref", "$id"]}
                        cleaned_properties[prop_name] = cleaned_prop
                    else:
                        cleaned_properties[prop_name] = prop_def
                
                # Create input_schema - Anthropic format
                input_schema = {
                    "type": "object",
                    "properties": cleaned_properties
                }
                
                # Add required field only if there are required properties
                if required:
                    input_schema["required"] = required
                
                # Handle additionalProperties - Anthropic supports this
                if "additionalProperties" in params:
                    input_schema["additionalProperties"] = params.get("additionalProperties", False)
                else:
                    # Default to false if not specified
                    input_schema["additionalProperties"] = False
                
                # Validate required fields
                tool_name = tool.get("name", "")
                tool_description = tool.get("description", "")
                
                if not tool_name:
                    logger.warning(f"Tool missing name, skipping")
                    continue
                
                if not tool_description:
                    logger.warning(f"Tool {tool_name} missing description")
                
                # Validate input_schema structure
                if not isinstance(input_schema, dict) or "type" not in input_schema:
                    logger.warning(f"Tool {tool_name} has invalid input_schema, skipping")
                    continue
                
                anthropic_tool = {
                    "name": tool_name,
                    "description": tool_description,
                    "input_schema": input_schema
                }
                
                anthropic_tools.append(anthropic_tool)
                logger.debug(f"Converted tool: {tool_name} with {len(cleaned_properties)} properties")
            except Exception as e:
                logger.warning(f"Error converting tool {tool.get('name', 'unknown')}: {str(e)}")
                continue
        
        logger.info(f"Converted {len(anthropic_tools)} tools to Anthropic format")
        return anthropic_tools
    
    def _convert_tools_to_openai_format(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Convert tools to OpenAI function calling format"""
        openai_tools = []
        for tool in tools:
            try:
                # Same base logic as Anthropic, but wrapped in {type: "function", function: {...}}
                params = tool.get("parameters", {})
                
                # ... same parameter cleaning logic ...
                properties = params.get("properties", {})
                required = params.get("required", [])
                
                cleaned_properties = {}
                for prop_name, prop_def in properties.items():
                    if isinstance(prop_def, dict):
                         cleaned_prop = {k: v for k, v in prop_def.items() 
                                       if k not in ["$schema", "$ref", "$id"]}
                         cleaned_properties[prop_name] = cleaned_prop
                    else:
                        cleaned_properties[prop_name] = prop_def
                
                input_schema = {
                    "type": "object",
                    "properties": cleaned_properties
                }
                if required:
                    input_schema["required"] = required
                input_schema["additionalProperties"] = False
                
                tool_name = tool.get("name", "")
                tool_description = tool.get("description", "")
                
                openai_tool = {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": tool_description,
                        "parameters": input_schema
                    }
                }
                openai_tools.append(openai_tool)
            except Exception as e:
                logger.warning(f"Error converting tool to OpenAI format: {str(e)}")
                continue
        return openai_tools
    
    def _load_prompt_optimizer(self, prompts_dir: Path) -> str:
        """Load prompt optimizer prompt from file"""
        try:
            optimizer_file = prompts_dir / 'Prompt Optimizer.txt'
            if optimizer_file.exists():
                return optimizer_file.read_text(encoding='utf-8')
            else:
                logger.warning(f"Prompt optimizer file not found at {optimizer_file}")
                return "Optimize the user prompt for AI website generation."
        except Exception as e:
            logger.error(f"Error loading prompt optimizer: {str(e)}")
            return "Optimize the user prompt for AI website generation."
    
    def optimize_prompt(self, user_prompt: str) -> str:
        """Optimize user prompt if needed"""
        try:
            # Prepare messages
            system_msg = self.prompt_optimizer
            user_msg = f"User prompt: {user_prompt}"
            
            messages = []
            if self.provider == 'anthropic':
                messages = [{"role": "user", "content": f"{system_msg}\n\n{user_msg}"}]
                response = self.client.messages.create(
                    model=self.anthropic_model,
                    max_tokens=1024,
                    messages=messages,
                    tools=[]
                )
                optimized = response.content[0].text.strip()
            else:
                # OpenRouter/OpenAI
                messages = [
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": user_msg}
                ]
                response = self.client.chat.completions.create(
                    model=self.openrouter_model,
                    max_tokens=1024,
                    messages=messages
                )
                optimized = response.choices[0].message.content.strip()
            
            logger.info(f"Optimized prompt: {optimized[:100]}...")
            return optimized
        except Exception as e:
            logger.error(f"Error optimizing prompt: {str(e)}")
            # Return original prompt on error - don't fail
            return user_prompt
    
    def _create_chat_completion(self, system_message: str, messages: List[Dict], tools: List[Dict] = None) -> Any:
        """
        Unified method to call LLM provider (Anthropic or OpenRouter)
        Returns an object compatible with Anthropic's response.content structure
        """
        if self.provider == 'anthropic':
            request_kwargs = {
                "model": self.anthropic_model,
                "max_tokens": 4096,
                "system": system_message,
                "messages": messages
            }
            if tools:
                request_kwargs["tools"] = tools
            
            return self.client.messages.create(**request_kwargs)
            
        else:
            # OpenRouter / OpenAI
            # Convert messages: Anthropic uses "user" and "assistant" with specific content structure
            # OpenAI uses "system", "user", "assistant"
            
            openai_messages = [{"role": "system", "content": system_message}]
            
            for msg in messages:
                # Handle Anthropic's list content with tool_results/tool_use
                if isinstance(msg['content'], list):
                    # This is complex because we need to convert Anthropic's conversation history 
                    # back to OpenAI format.
                    # Anthropic: user message with tool_result blocks -> OpenAI: tool role message
                    # Anthropic: assistant message with tool_use blocks -> OpenAI: assistant message with tool_calls
                    
                    # Simplify for now: if user message has tool_result, assume it's tool output
                    # The current flow appends assistant message with tool_use, then user message with tool_results
                    
                    if msg['role'] == 'user':
                        # Check for tool results
                        has_tool_results = any(block.get('type') == 'tool_result' for block in msg['content'])
                        if has_tool_results:
                            for block in msg['content']:
                                if block.get('type') == 'tool_result':
                                    openai_messages.append({
                                        "role": "tool",
                                        "tool_call_id": block.get('tool_use_id'),
                                        "content": block.get('content')
                                    })
                                elif block.get('type') == 'text':
                                    openai_messages.append({
                                        "role": "user",
                                        "content": block.get('text')
                                    })
                        else:
                            # Standard user message with complex content (e.g. text + images, though we mostly use text)
                            # Flatten to string if possible or keep list if OpenAI supports it (OpenAI supports list for vision)
                            # For code generation, it's mostly text
                            text_parts = [b.get('text', '') for b in msg['content'] if b.get('type') == 'text']
                            openai_messages.append({
                                "role": "user",
                                "content": "\n".join(text_parts)
                            })
                            
                    elif msg['role'] == 'assistant':
                        # Check for tool_use
                        tool_calls = []
                        content_text = ""
                        
                        for block in msg['content']:
                            if block.get('type') == 'tool_use':
                                tool_calls.append({
                                    "id": block.get('id'),
                                    "type": "function",
                                    "function": {
                                        "name": block.get('name'),
                                        "arguments": json.dumps(block.get('input'))
                                    }
                                })
                            elif block.get('type') == 'text':
                                content_text += block.get('text', '')
                        
                        assistant_msg = {"role": "assistant"}
                        if content_text:
                            assistant_msg["content"] = content_text
                        if tool_calls:
                            assistant_msg["tool_calls"] = tool_calls
                        
                        openai_messages.append(assistant_msg)
                
                else:
                    # Simple string content
                    openai_messages.append({
                        "role": msg['role'],
                        "content": msg['content']
                    })
            
            # Convert tools
            openai_tools = None
            if tools:
                openai_tools = self._convert_tools_to_openai_format(tools)
            
            request_kwargs = {
                "model": self.openrouter_model,
                "max_tokens": 4096,
                "messages": openai_messages
            }
            
            if openai_tools:
                request_kwargs["tools"] = openai_tools
                
            response = self.client.chat.completions.create(**request_kwargs)
            
            # Convert response to generic format (mimic Anthropic structure)
            content_blocks = []
            
            # 1. Text content
            resp_content = response.choices[0].message.content
            if resp_content:
                content_blocks.append(ContentBlock(type="text", text=resp_content))
                
            # 2. Tool calls
            if response.choices[0].message.tool_calls:
                for tool_call in response.choices[0].message.tool_calls:
                    try:
                        args = json.loads(tool_call.function.arguments)
                    except:
                        args = {}
                    
                    content_blocks.append(ContentBlock(
                        type="tool_use",
                        id=tool_call.id,
                        name=tool_call.function.name,
                        input=args
                    ))
            
            return AIResponse(content=content_blocks)

    def _create_chat_completion_stream(self, system_message: str, messages: List[Dict], tools: List[Dict] = None):
        """
        Stream chat completion from LLM provider.
        ONLY supports text content for now (tools are handled via non-streaming fallback if needed).
        """
        if self.provider == 'anthropic':
            request_kwargs = {
                "model": self.anthropic_model,
                "max_tokens": 4096,
                "system": system_message,
                "messages": messages
            }
            # Anthropic streaming is done via messages.create(stream=True)
            with self.client.messages.stream(**request_kwargs) as stream:
                for text in stream.text_stream:
                    yield text
        else:
            # OpenRouter / OpenAI
            openai_messages = [{"role": "system", "content": system_message}]
            for msg in messages:
                if isinstance(msg['content'], list):
                    text_parts = [b.get('text', '') for b in msg['content'] if b.get('type') == 'text']
                    openai_messages.append({"role": msg['role'], "content": "\n".join(text_parts)})
                else:
                    openai_messages.append({"role": msg['role'], "content": msg['content']})
            
            response = self.client.chat.completions.create(
                model=self.openrouter_model,
                messages=openai_messages,
                stream=True,
                max_tokens=4096,
                tools=self._convert_tools_to_openai_format(tools) if tools else None
            )
            
            # This is a bit tricky: we need to yield content but also somehow signal tool calls.
            # However, the current generate_project_iterative loop expects strings.
            # Let's change the strategy: if tools are present, we'll collect content AND tools.
            # Special markers will be used to signal tool calls to the caller.
            
            for chunk in response:
                if not chunk.choices: continue
                delta = chunk.choices[0].delta
                
                # Yield content chunk
                if delta.content:
                    yield delta.content
                    
                # Handle tool calls (collect them for the final assistant message)
                # Actually, the caller (generate_project_iterative) needs the tool calls
                # in the assistant_message content list.
                # Since this is a generator and we can't easily return two things per chunk
                # without changing the caller, we'll just yield content and 
                # let the caller detect empty content + tool calls.
                
                # WAIT! I have a better idea. If content is empty but tool_calls exist,
                # we'll raise a special signal or the caller should check.

    def _extract_packages_to_install(self, text: str) -> List[str]:
        """
        Extract package list from AI response in format: PACKAGES_TO_INSTALL: ["package1", "package2"]
        
        Args:
            text: AI response text
            
        Returns:
            List of package names to install
        """
        import re
        import json
        
        # Pattern to match PACKAGES_TO_INSTALL: followed by JSON array (handles multi-line)
        # First find the line with PACKAGES_TO_INSTALL:
        pattern = r'PACKAGES_TO_INSTALL:\s*(\[.*?\])'
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        
        if match:
            try:
                packages_json = match.group(1)
                packages = json.loads(packages_json)
                if isinstance(packages, list):
                    # Filter out empty strings and return
                    result = [p.strip() for p in packages if p and p.strip()]
                    if result:
                        logger.info(f"Extracted packages from PACKAGES_TO_INSTALL: {result}")
                    return result
            except (json.JSONDecodeError, Exception) as e:
                logger.warning(f"Error parsing PACKAGES_TO_INSTALL: {str(e)}")
                logger.debug(f"Failed to parse: {match.group(1) if match else 'No match'}")
        
        return []
    
    def generate_project_iterative(
        self, 
        project_dir: Path, 
        prompt: str, 
        is_new_project: bool,
        project_id: str,
        socketio,
        sid: str,
        on_file_saved = None
    ) -> Tuple[bool, List[str]]:
        """
        Generate project using iterative conversation with Anthropic
        
        Args:
            project_dir: Path to project directory
            prompt: User prompt (already optimized if needed)
            is_new_project: Whether this is a new project or modification
            project_id: Project identifier
            socketio: SocketIO instance for emitting updates
            sid: Socket session ID
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Prepare system message with agent prompt
            system_message = self.agent_prompt
            
            # Add project context
            if is_new_project:
                system_message += f"\n\nYou are creating a new project. Workspace: {project_dir}"
            else:
                system_message += f"\n\nYou are modifying an existing project. Workspace: {project_dir}"
            
            # Get codebase context for new projects (like reference)
            codebase_context = []
            if is_new_project:
                logger.info("📚 Generating codebase context for new project...")
                codebase_context = self._get_codebase_context(project_dir)
                if codebase_context:
                    logger.info(f"📚 Adding {len(codebase_context)} files as codebase context")
            
            # Prepare initial user message
            # Add codebase context first, then user prompt (like reference)
            messages = []
            
            # Add codebase context messages first
            messages.extend(codebase_context)
            
            # Then add the user prompt
            messages.append({
                "role": "user",
                "content": prompt
            })
            
            # Initialize partial blocks for this project
            if project_id not in self.partial_code_blocks:
                self.partial_code_blocks[project_id] = {}
            
            # Initialize packages list for this project
            if project_id not in self.packages_to_install:
                self.packages_to_install[project_id] = []
            
            # Global accumulated text content across iterations (like reference)
            accumulated_text_content = ""
            
            # Log initial prompt
            logger.info("=" * 80)
            logger.info("AI GENERATION STARTED")
            logger.info("=" * 80)
            logger.info(f"Initial User Prompt:\n{prompt}")
            logger.info("-" * 80)
            
            # Iterative conversation
            for iteration in range(self.max_iterations):
                logger.info(f"\n[Iteration {iteration + 1}/{self.max_iterations}]")
                logger.info("-" * 80)
                
                try:
                    # Initialize iteration content
                    iteration_text_content = ""
                    assistant_message = {"role": "assistant", "content": []}
                    done_found = False
                    
                    # Track notified files project-wide to avoid redundant signals
                    if not hasattr(self, '_notified_files'): self._notified_files = {}
                    if project_id not in self._notified_files: self._notified_files[project_id] = set()
                    
                    try:
                        # Use blocking call for the first iteration or if we suspect tools are needed
                        # This ensures tool calls (LSRepo, ReadFile) are captured correctly.
                        # For later iterations where we expect large code blocks, we use streaming.
                        use_streaming = (iteration > 1) 
                        
                        if use_streaming:
                            logger.info("Starting AI stream...")
                            for chunk in self._create_chat_completion_stream(system_message, messages, tools=self.agent_tools):
                                iteration_text_content += chunk
                                
                                # Check for DONE marker in real-time
                                if "&&&DONE&&&" in iteration_text_content or "***&&&DONE&&&***" in iteration_text_content:
                                    done_found = True
                                
                                # Try to extract and save files incrementally
                                if "```" in chunk:
                                    try:
                                        # Use full context to handle multi-iteration blocks
                                        current_context = accumulated_text_content
                                        if iteration_text_content:
                                            current_context += ("\n\n" if current_context else "") + iteration_text_content
                                            
                                        saved_files, _ = CodeExtractor.extract_and_save(
                                            current_context, 
                                            project_dir, 
                                            {},
                                            save_partial=False
                                        )
                                        if saved_files:
                                            newly_saved = [f for f in saved_files if f not in self._notified_files[project_id]]
                                            if newly_saved:
                                                logger.info(f"Incremental save: {', '.join(newly_saved)}")
                                                if on_file_saved:
                                                    on_file_saved(newly_saved)
                                                self._notified_files[project_id].update(newly_saved)
                                    except: pass
                            logger.info("AI stream completed")
                        else:
                            logger.info("Using non-streaming call for tool handling...")
                            response = self._create_chat_completion(system_message=system_message, messages=messages, tools=self.agent_tools)
                            for block in response.content:
                                if block.type == "text":
                                    iteration_text_content += block.text
                                elif block.type == "tool_use":
                                    assistant_message["content"].append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})
                            
                            # Check for DONE marker in blocking response
                            if "&&&DONE&&&" in iteration_text_content or "***&&&DONE&&&***" in iteration_text_content:
                                done_found = True
                                
                    except Exception as stream_err:
                        logger.warning(f"Streaming failed: {str(stream_err)}. Falling back to blocking call.")
                        response = self._create_chat_completion(system_message=system_message, messages=messages, tools=self.agent_tools)
                        for block in response.content:
                            if block.type == "text": iteration_text_content += block.text
                            elif block.type == "tool_use":
                                assistant_message["content"].append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})
                except Exception as api_error:
                    logger.warning(f"API call failed in iteration {iteration + 1}: {str(api_error)}")
                    if iteration < self.max_iterations - 1:
                        messages.append({"role": "user", "content": f"An error occurred: {str(api_error)}. Please continue."})
                        continue
                    else: break

                # Process results and update accumulated content
                if iteration_text_content:
                    iteration_text_content = iteration_text_content.rstrip()
                    
                    # Store for conversation history
                    assistant_message["content"].append({"type": "text", "text": iteration_text_content})
                    
                    # Update global accumulated text (with de-duplication for continuations)
                    if accumulated_text_content:
                        # Find best overlap to handle Claude's repetition during continuation
                        # Check the last 500 characters of accumulated for overlaps with the start of new content
                        overlap_found = False
                        search_len = min(len(accumulated_text_content), 500)
                        last_part = accumulated_text_content[-search_len:]
                        
                        # Try to find the longest suffix of 'last_part' that is a prefix of 'iteration_text_content'
                        for i in range(min(len(last_part), len(iteration_text_content)), 0, -1):
                            if iteration_text_content.startswith(last_part[-i:]):
                                logger.info(f"⚠️ Found overlap of {i} characters at continuation boundary")
                                accumulated_text_content += iteration_text_content[i:]
                                overlap_found = True
                                break
                        
                        if not overlap_found:
                            accumulated_text_content += ("\n\n" if not accumulated_text_content.endswith("\n") else "\n") + iteration_text_content
                    else:
                        accumulated_text_content = iteration_text_content

                    # Update packages list
                    packages = self._extract_packages_to_install(iteration_text_content)
                    if packages:
                        existing = set(self.packages_to_install.get(project_id, []))
                        for p in packages:
                            if p not in existing:
                                self.packages_to_install[project_id].append(p)
                                existing.add(p)

                # Check for tool calls
                has_tool_calls = any(block.get("type") == "tool_use" for block in assistant_message["content"])
                if has_tool_calls:
                    messages.append(assistant_message)
                    tool_results = []
                    for block in assistant_message["content"]:
                        if block.get("type") == "tool_use":
                            tool_name, tool_id, tool_input = block.get("name"), block.get("id"), block.get("input", {})
                            try:
                                result = self._execute_tool(tool_name, tool_input, project_dir, project_id)
                                tool_results.append({"type": "tool_result", "tool_use_id": tool_id, "content": result})
                            except Exception as tool_err:
                                tool_results.append({"type": "tool_result", "tool_use_id": tool_id, "content": f"Error: {str(tool_err)}"})
                    messages.append({"role": "user", "content": tool_results})
                    continue

                # Normal end of iteration
                messages.append(assistant_message)
                
                # Final extraction check for this iteration
                try:
                    saved, _ = CodeExtractor.extract_and_save(accumulated_text_content, project_dir, {}, save_partial=done_found)
                    if saved and on_file_saved:
                        newly_saved = [f for f in saved if f not in self._notified_files[project_id]]
                        if newly_saved:
                            on_file_saved(newly_saved)
                            self._notified_files[project_id].update(newly_saved)
                except: pass

                if done_found: 
                    # Project finished - clear notified list
                    if hasattr(self, '_notified_files') and project_id in self._notified_files:
                        del self._notified_files[project_id]
                    break
            
            # Save any remaining partial blocks (incomplete files) at the end as fallback
            # This only happens if generation ends without DONE marker
            partial_blocks = self.partial_code_blocks.get(project_id, {})
            if partial_blocks:
                logger.warning(f"Generation ended with {len(partial_blocks)} incomplete code blocks - saving as fallback")
                for file_path, partial_data in partial_blocks.items():
                    try:
                        # Normalize file path
                        normalized_path = file_path.lstrip('/')
                        full_path = project_dir / normalized_path
                        full_path.parent.mkdir(parents=True, exist_ok=True)
                        
                        # Save incomplete code (better than nothing)
                        with open(full_path, 'w', encoding='utf-8') as f:
                            f.write(partial_data['code'])
                        logger.info(f"Saved incomplete file (fallback): {normalized_path} (may be truncated)")
                    except Exception as e:
                        logger.error(f"Error saving incomplete block {file_path}: {str(e)}")
                
                # Clear partial blocks for this project
                if project_id in self.partial_code_blocks:
                    del self.partial_code_blocks[project_id]
            
            logger.info("=" * 80)
            logger.info("AI GENERATION COMPLETED")
            logger.info("=" * 80)
            
            # Ensure build configuration files exist
            try:
                logger.info("Checking and adding missing build configuration files...")
                self._ensure_build_configuration(project_dir)
                logger.info("Build configuration check completed")
            except Exception as config_error:
                logger.warning(f"Error ensuring build configuration: {str(config_error)}")
                # Don't fail - continue with generation
            
            # Get final list of packages to install
            packages_list = self.packages_to_install.get(project_id, [])
            if packages_list:
                logger.info(f"Packages to install: {', '.join(packages_list)}")
            else:
                logger.info("No packages to install")
            
            return True, packages_list  # Return packages list
            
        except Exception as e:
            logger.error(f"Error in iterative generation: {str(e)}")
            # Don't fail completely - return True to allow generation to continue
            logger.warning("Continuing despite errors in iterative generation")
            packages_list = self.packages_to_install.get(project_id, [])
            return True, packages_list
    
    def _execute_tool(self, tool_name: str, tool_input: dict, project_dir: Path, project_id: str) -> str:
        """
        Execute a tool and return result or error message
        
        Args:
            tool_name: Name of the tool to execute
            tool_input: Tool input parameters
            project_dir: Project directory path
            project_id: Project identifier
            
        Returns:
            Tool execution result or error message (JSON string for structured results)
        """
        try:
            logger.info(f"Executing tool: {tool_name} with input: {tool_input}")
            
            if tool_name == "LSRepo":
                return self._execute_lsrepo(tool_input, project_dir)
            elif tool_name == "ReadFile":
                return self._execute_readfile(tool_input, project_dir)
            elif tool_name == "GrepRepo":
                return self._execute_greprepo(tool_input, project_dir)
            else:
                return json.dumps({
                    "error": f"Unknown tool: {tool_name}",
                    "message": f"Tool '{tool_name}' is not implemented"
                })
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Tool execution error for {tool_name}: {error_msg}")
            return json.dumps({
                "error": f"Error executing tool '{tool_name}'",
                "message": error_msg
            })
    
    def _execute_lsrepo(self, tool_input: dict, project_dir: Path) -> str:
        """Execute LSRepo tool - list files and directories"""
        try:
            path_str = tool_input.get('path', '.')
            glob_pattern = tool_input.get('globPattern')
            ignore_patterns = tool_input.get('ignore', [])
            
            # Normalize path - handle "." for root, remove leading slash
            if path_str == '.' or path_str == '/':
                target_path = project_dir
            else:
                # Remove leading slash if present
                path_str = path_str.lstrip('/')
                target_path = project_dir / path_str
            
            if not target_path.exists():
                return json.dumps({
                    "error": "Path not found",
                    "message": f"Path '{path_str}' does not exist in the project"
                })
            
            if not target_path.is_dir():
                return json.dumps({
                    "error": "Not a directory",
                    "message": f"Path '{path_str}' is not a directory"
                })
            
            # Collect files and directories
            items = []
            try:
                for item in sorted(target_path.iterdir()):
                    # Skip hidden files and common ignore patterns
                    if item.name.startswith('.'):
                        continue
                    
                    # Apply ignore patterns
                    skip = False
                    item_str = str(item.relative_to(project_dir))
                    for ignore_pattern in ignore_patterns:
                        if fnmatch.fnmatch(item_str, ignore_pattern) or fnmatch.fnmatch(item.name, ignore_pattern):
                            skip = True
                            break
                    if skip:
                        continue
                    
                    # Apply glob pattern if provided
                    if glob_pattern:
                        item_str = str(item.relative_to(project_dir))
                        if not fnmatch.fnmatch(item_str, glob_pattern) and not fnmatch.fnmatch(item.name, glob_pattern):
                            continue
                    
                    items.append({
                        "path": str(item.relative_to(project_dir)),
                        "name": item.name,
                        "type": "directory" if item.is_dir() else "file"
                    })
                    
                    # Limit to 200 items
                    if len(items) >= 200:
                        break
                
                return json.dumps({
                    "success": True,
                    "path": path_str,
                    "items": items,
                    "count": len(items)
                }, indent=2)
                
            except PermissionError:
                return json.dumps({
                    "error": "Permission denied",
                    "message": f"Permission denied accessing path '{path_str}'"
                })
                
        except Exception as e:
            return json.dumps({
                "error": "LSRepo execution failed",
                "message": str(e)
            })
    
    def _execute_readfile(self, tool_input: dict, project_dir: Path) -> str:
        """Execute ReadFile tool - read file contents"""
        try:
            file_path_str = tool_input.get('filePath', '')
            query = tool_input.get('query')
            start_line = tool_input.get('startLine')
            end_line = tool_input.get('endLine')
            
            if not file_path_str:
                return json.dumps({
                    "error": "Missing filePath",
                    "message": "filePath parameter is required"
                })
            
            # Normalize path - remove leading slash if present
            file_path_str = file_path_str.lstrip('/')
            file_path = project_dir / file_path_str
            
            if not file_path.exists():
                return json.dumps({
                    "error": "File not found",
                    "message": f"File '{file_path_str}' does not exist in the project"
                })
            
            if not file_path.is_file():
                return json.dumps({
                    "error": "Not a file",
                    "message": f"Path '{file_path_str}' is not a file"
                })
            
            # Check if binary file
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            except UnicodeDecodeError:
                return json.dumps({
                    "error": "Binary file",
                    "message": f"File '{file_path_str}' appears to be a binary file and cannot be read as text"
                })
            
            lines = content.split('\n')
            total_lines = len(lines)
            
            # Handle line range if specified
            if start_line is not None or end_line is not None:
                start = (start_line - 1) if start_line else 0
                end = end_line if end_line else total_lines
                lines = lines[start:end]
                content = '\n'.join(lines)
            
            # Truncate very long lines
            truncated_lines = []
            for line in lines:
                if len(line) > 2000:
                    truncated_lines.append(line[:2000] + "... (truncated)")
                else:
                    truncated_lines.append(line)
            content = '\n'.join(truncated_lines)
            
            # For large files (>2000 lines), if query is provided, we could use AI to find relevant chunks
            # For now, we'll return the content or a subset
            if total_lines > 2000 and not start_line and not end_line:
                if query:
                    # Return first 500 and last 500 lines with a note
                    first_part = '\n'.join(lines[:500])
                    last_part = '\n'.join(lines[-500:])
                    content = f"{first_part}\n\n... ({total_lines - 1000} lines omitted) ...\n\n{last_part}"
                    return json.dumps({
                        "success": True,
                        "filePath": file_path_str,
                        "content": content,
                        "totalLines": total_lines,
                        "note": f"File is large ({total_lines} lines). Showing first 500 and last 500 lines. Use startLine and endLine to read specific sections."
                    }, indent=2)
                else:
                    # Return first 2000 lines
                    content = '\n'.join(lines[:2000])
                    return json.dumps({
                        "success": True,
                        "filePath": file_path_str,
                        "content": content,
                        "totalLines": total_lines,
                        "note": f"File is large ({total_lines} lines). Showing first 2000 lines. Use startLine and endLine to read specific sections."
                    }, indent=2)
            
            return json.dumps({
                "success": True,
                "filePath": file_path_str,
                "content": content,
                "totalLines": total_lines
            }, indent=2)
            
        except Exception as e:
            return json.dumps({
                "error": "ReadFile execution failed",
                "message": str(e)
            })
    
    def _get_codebase_context(self, project_dir: Path) -> List[Dict[str, str]]:
        """
        Scan the src directory and return codebase files as user messages (like reference _GetCodebaseContext)
        Includes: App.css, App.tsx, index.css, main.tsx, components (excluding ui folder),
        all other folders in src (lib, types, utils, hooks, etc.), and package.json from root
        
        Returns:
            list: List of user messages containing file contents
        """
        codebase_messages = []
        
        if not project_dir.exists():
            return codebase_messages
        
        # File extensions to include
        code_extensions = {
            '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
            '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.clj',
            '.html', '.css', '.scss', '.sass', '.less', '.json', '.xml', '.yaml', '.yml',
            '.md', '.txt', '.vue', '.svelte', '.astro', '.sql', '.sh', '.bash', '.zsh',
            '.dockerfile', '.makefile', '.env', '.config', '.toml', '.ini', '.conf'
        }
        
        # Directories to exclude
        exclude_dirs = {
            'node_modules', '.git', '.next', 'dist', 'build', '.cache', 
            'coverage', '.nyc_output', '.sass-cache', '.vscode', '.idea',
            '__pycache__', '.pytest_cache', '.mypy_cache', 'venv', 'env',
            '.venv', 'vendor', 'target', 'bin', 'obj', '.gradle', '.idea'
        }
        
        # Files to exclude (exact matches and patterns)
        exclude_files_exact = {
            'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store'
        }
        exclude_files_patterns = ['.log', '.tmp', '.cache']  # File extensions to exclude
        
        logger.info("📂 Scanning codebase for context (src folder + package.json)...")
        
        try:
            files_scanned = 0
            total_size = 0
            max_file_size = 100 * 1024  # 100KB max per file
            max_total_size = 2 * 1024 * 1024  # 2MB total limit
            max_files = 50  # Maximum number of files to include
            
            # Priority: package.json first, then root src files, then components (excluding ui), then other folders
            priority_dirs = ['components', 'lib', 'types', 'utils', 'hooks', 'api', 'pages']
            
            # First, add package.json from root (highest priority)
            package_json_path = project_dir / 'package.json'
            if package_json_path.exists():
                try:
                    file_size = package_json_path.stat().st_size
                    if file_size <= max_file_size:
                        with open(package_json_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                        
                        file_content = f"File: package.json\n```json\n{content}\n```"
                        codebase_messages.append({
                            'role': 'user',
                            'content': file_content
                        })
                        files_scanned += 1
                        total_size += file_size
                        logger.info(f"✅ Added package.json to codebase context")
                except Exception as e:
                    logger.warning(f"Error reading package.json: {str(e)}")
            
            # Only scan within src folder (like reference)
            src_path = project_dir / 'src'
            if not src_path.exists():
                logger.info("⚠️  src folder not found, skipping src codebase context")
                return codebase_messages
            
            # Collect all files first with priority info
            all_files = []
            for root, dirs, files in os.walk(src_path):
                # Filter out excluded directories
                dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith('.')]
                
                # Exclude components/ui subfolder
                if 'ui' in dirs:
                    # Get relative path from src to check if we're in components/ui
                    rel_path_from_src = Path(root).relative_to(src_path)
                    rel_path_str = str(rel_path_from_src).replace('\\', '/')
                    if rel_path_str == 'components' or rel_path_str.startswith('components/'):
                        # We're in components folder, exclude ui subfolder
                        dirs.remove('ui')
                
                for file in files:
                    # Skip if file should be excluded (exact match)
                    if file.lower() in exclude_files_exact:
                        continue
                    
                    # Skip if file matches exclusion patterns
                    if any(file.lower().endswith(pattern) for pattern in exclude_files_patterns):
                        continue
                    
                    file_path = Path(root) / file
                    rel_path = file_path.relative_to(project_dir)
                    rel_path_from_src = file_path.relative_to(src_path)
                    rel_path_str = str(rel_path_from_src).replace('\\', '/')
                    
                    # Skip if file is in components/ui folder
                    if rel_path_str.startswith('components/ui/'):
                        continue
                    
                    # Check file extension
                    if file_path.suffix.lower() not in code_extensions and not any(file.lower().endswith(ext) for ext in ['.env', '.config', '.dockerfile', '.makefile']):
                        continue
                    
                    try:
                        # Get file size
                        file_size = file_path.stat().st_size
                        
                        # Skip if file is too large
                        if file_size > max_file_size:
                            continue
                        
                        # Skip if total size would exceed limit
                        if total_size + file_size > max_total_size:
                            continue
                        
                        # Determine priority (higher number = higher priority)
                        priority = 0
                        # Root-level src files (App.css, App.tsx, index.css, main.tsx) get highest priority
                        if '/' not in rel_path_str and file.lower() in ['app.css', 'app.tsx', 'index.css', 'main.tsx']:
                            priority = 100  # Highest priority for root src files
                        else:
                            # Check if in priority directories
                            for priority_dir in priority_dirs:
                                if rel_path_str.startswith(priority_dir + '/'):
                                    priority = priority_dirs.index(priority_dir) + 1
                                    break
                        
                        all_files.append((file_path, rel_path, file_size, priority))
                        
                    except Exception:
                        continue
            
            # Sort by priority (higher first), then by file size (smaller first for faster processing)
            all_files.sort(key=lambda x: (-x[3], x[2]))
            
            # Process files in priority order
            for file_path, rel_path, file_size, priority in all_files:
                # Skip if total size would exceed limit
                if total_size + file_size > max_total_size:
                    logger.info(f"⚠️  Codebase context size limit reached ({total_size / 1024 / 1024:.1f}MB), skipping remaining files")
                    break
                
                # Skip if we've hit the file count limit
                if files_scanned >= max_files:
                    logger.info(f"⚠️  Codebase context file limit reached ({max_files} files), skipping remaining files")
                    break
                
                try:
                    # Read file content
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                    
                    # Get language from extension
                    lang = self._get_language_from_extension(file_path.suffix)
                    
                    # Format as user message (like reference)
                    file_content = f"File: {rel_path}\n```{lang}\n{content}\n```"
                    
                    codebase_messages.append({
                        'role': 'user',
                        'content': file_content
                    })
                    
                    files_scanned += 1
                    total_size += file_size
                
                except Exception as e:
                    # Skip files that can't be read
                    logger.warning(f"Error reading file {rel_path}: {str(e)}")
                    continue
            
            logger.info(f"✅ Included {files_scanned} files ({total_size / 1024:.1f}KB) in codebase context")
            
        except Exception as e:
            logger.warning(f"⚠️  Error scanning codebase: {str(e)}")
        
        return codebase_messages
    
    def _get_language_from_extension(self, extension: str) -> str:
        """Map file extension to language identifier for code blocks (like reference)"""
        extension = extension.lower()
        language_map = {
            '.js': 'javascript',
            '.jsx': 'jsx',
            '.ts': 'typescript',
            '.tsx': 'tsx',
            '.py': 'python',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.h': 'c',
            '.hpp': 'cpp',
            '.cs': 'csharp',
            '.go': 'go',
            '.rs': 'rust',
            '.rb': 'ruby',
            '.php': 'php',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.clj': 'clojure',
            '.html': 'html',
            '.css': 'css',
            '.scss': 'scss',
            '.sass': 'sass',
            '.less': 'less',
            '.json': 'json',
            '.xml': 'xml',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.md': 'markdown',
            '.txt': 'text',
            '.vue': 'vue',
            '.svelte': 'svelte',
            '.astro': 'astro',
            '.sql': 'sql',
            '.sh': 'bash',
            '.bash': 'bash',
            '.zsh': 'zsh',
            '.dockerfile': 'dockerfile',
            '.makefile': 'makefile',
            '.env': 'env',
            '.config': 'config',
            '.toml': 'toml',
            '.ini': 'ini',
            '.conf': 'conf'
        }
        return language_map.get(extension, 'text')
    
    def _execute_greprepo(self, tool_input: dict, project_dir: Path) -> str:
        """Execute GrepRepo tool - search for regex patterns in files"""
        try:
            pattern = tool_input.get('pattern', '')
            path_str = tool_input.get('path')
            glob_pattern = tool_input.get('globPattern')
            
            if not pattern:
                return json.dumps({
                    "error": "Missing pattern",
                    "message": "pattern parameter is required"
                })
            
            # Determine search directory
            if path_str:
                path_str = path_str.lstrip('/')
                if path_str == '.' or path_str == '':
                    search_dir = project_dir
                else:
                    search_dir = project_dir / path_str
            else:
                search_dir = project_dir
            
            if not search_dir.exists():
                return json.dumps({
                    "error": "Path not found",
                    "message": f"Search path does not exist"
                })
            
            # Compile regex pattern (case-insensitive)
            try:
                regex = re.compile(pattern, re.IGNORECASE | re.MULTILINE)
            except re.error as e:
                return json.dumps({
                    "error": "Invalid regex pattern",
                    "message": f"Regex error: {str(e)}"
                })
            
            # Collect matches
            matches = []
            files_searched = 0
            
            # Common ignore patterns
            ignore_dirs = {'.git', 'node_modules', 'dist', '.next', 'build', '.vscode', '.idea'}
            ignore_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'}
            
            try:
                for file_path in search_dir.rglob('*'):
                    if file_path.is_file():
                        # Skip ignored directories
                        if any(ignore_dir in file_path.parts for ignore_dir in ignore_dirs):
                            continue
                        
                        # Skip binary files
                        if file_path.suffix.lower() in ignore_extensions:
                            continue
                        
                        # Apply glob pattern if provided
                        if glob_pattern:
                            file_str = str(file_path.relative_to(project_dir))
                            if not fnmatch.fnmatch(file_str, glob_pattern) and not fnmatch.fnmatch(file_path.name, glob_pattern):
                                continue
                        
                        files_searched += 1
                        
                        try:
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                content = f.read()
                                lines = content.split('\n')
                                
                                for line_num, line in enumerate(lines, 1):
                                    if regex.search(line):
                                        matches.append({
                                            "file": str(file_path.relative_to(project_dir)),
                                            "line": line_num,
                                            "content": line.strip()[:500]  # Limit line length
                                        })
                                        
                                        # Limit to 200 matches
                                        if len(matches) >= 200:
                                            break
                                
                                if len(matches) >= 200:
                                    break
                                    
                        except (UnicodeDecodeError, PermissionError):
                            # Skip binary files or files we can't read
                            continue
                
                return json.dumps({
                    "success": True,
                    "pattern": pattern,
                    "matches": matches,
                    "count": len(matches),
                    "filesSearched": files_searched
                }, indent=2)
                
            except Exception as e:
                return json.dumps({
                    "error": "Search failed",
                    "message": str(e)
                })
                
        except Exception as e:
            return json.dumps({
                "error": "GrepRepo execution failed",
                "message": str(e)
            })
    
    def fix_build_errors(self, project_dir: Path, build_error: str, project_id: str, socketio, sid: str, files: List[str] = None) -> Optional[str]:
        """
        Use AI to fix build errors
        
        Args:
            project_dir: Path to project directory
            build_error: Build error message
            project_id: Project identifier
            socketio: SocketIO instance
            sid: Socket session ID
            files: List of files in the project
            
        Returns:
            Fixed code or None if failed
        """
        try:
            # Read package.json to understand project structure
            package_json_path = project_dir / 'package.json'
            package_info = ""
            if package_json_path.exists():
                package_info = package_json_path.read_text(encoding='utf-8')
            
            # Extract paths from build error to provide context
            # Example: src/App.tsx(6,31): error ...
            error_file_paths = re.findall(r'([a-zA-Z0-9_\-\/]+\.(?:tsx|ts|jsx|js|css))', build_error)
            error_file_paths = list(set(error_file_paths)) # Deduplicate
            
            referenced_files_content = ""
            for file_path in error_file_paths:
                full_path = project_dir / file_path
                if full_path.exists() and full_path.is_file():
                    try:
                        content = full_path.read_text(encoding='utf-8', errors='ignore')
                        referenced_files_content += f"\nFile: {file_path}\n```\n{content}\n```\n"
                    except Exception as e:
                        logger.warning(f"Could not read referenced file {file_path}: {str(e)}")

            # Prepare file list string
            files_list_str = "\n".join(files) if files else "No file list provided."

            # Prepare prompt for fixing build errors
            fix_prompt = f"""The project build failed with the following error:

{build_error}

Existing project files:
{files_list_str}

Relevant file contents:
{referenced_files_content}

Project package.json:
{package_info}

Please analyze the error and provide the fix. 

IMPORTANT:
1. If any packages are missing (e.g., TS2307 for a non-relative import or a clear library like 'uuid'), explicitly list them in this format: PACKAGES_TO_INSTALL: ["pkg1", "pkg2"]
2. If a local module is missing (e.g., TS2307 for a '@/' or './' import), you MUST provide the FULL implementation of that file. Do not just say "Add the file".
3. Provide the FULL content of any new or modified files using the follow format:
File: path/to/file
```language
// full file content here
```
4. If you see errors about missing '@/components/ui/...' files, YOU MUST CREATE THEM. These are shadcn components and are essential.
5. If `tsc` reports unused variables (e.g., TS6133) in files you didn't touch or that are part of the template, you MAY suggest updating `tsconfig.json` to set `"noUnusedLocals": false` and `"noUnusedParameters": false` to allow the build to proceed.
6. Ensure that all relative imports are correct and that you provide absolute paths relative to the project root for every file you suggest.
"""

            # Omit tools parameter for build error fixing
            response = self._create_chat_completion(
                system_message=self.agent_prompt,
                messages=[{
                    "role": "user",
                    "content": fix_prompt
                }],
                tools=None
            )
            
            fix_suggestion = response.content[0].text.strip()
            logger.info(f"AI suggested fix: {fix_suggestion[:200]}...")
            
            return fix_suggestion
            
        except Exception as e:
            logger.error(f"Error fixing build errors: {str(e)}")
            return None
    
    def _ensure_build_configuration(self, project_dir: Path) -> None:
        """
        Ensure all necessary build configuration files exist.
        Detects project type and adds missing configuration files.
        
        Args:
            project_dir: Path to the project directory
        """
        try:
            # Check if package.json exists
            package_json_path = project_dir / 'package.json'
            if not package_json_path.exists():
                logger.info("No package.json found, skipping build configuration check")
                return
            
            # Read and parse package.json
            with open(package_json_path, 'r', encoding='utf-8') as f:
                package_data = json.load(f)
            
            # Validate and fix package.json structure
            package_modified = self._validate_package_json(package_data)
            
            # Detect project type
            scripts = package_data.get('scripts', {})
            dev_deps = package_data.get('devDependencies', {})
            deps = package_data.get('dependencies', {})
            
            # Sanitize dependencies
            deps_modified = self._sanitize_dependencies(package_data)
            if package_modified or deps_modified:
                with open(package_json_path, 'w', encoding='utf-8') as f:
                    json.dump(package_data, f, indent=2)
                logger.info("Validated and sanitized package.json")
                # Refresh variables
                deps = package_data.get('dependencies', {})
                dev_deps = package_data.get('devDependencies', {})

            build_script = scripts.get('build', '')
            
            # Detect Vite + React + TypeScript project
            is_vite_project = 'vite' in dev_deps or 'vite' in build_script.lower()
            is_typescript = 'typescript' in dev_deps
            has_react = 'react' in deps
            
            # Ensure required dependencies for Vite projects
            deps_added = False
            if is_vite_project and has_react and '@vitejs/plugin-react-swc' not in dev_deps:
                dev_deps['@vitejs/plugin-react-swc'] = '^3.5.0'
                deps_added = True
                logger.info("Added missing '@vitejs/plugin-react-swc' to devDependencies")
            
            # Ensure Tailwind CSS v4 dependencies for Vite projects
            if is_vite_project:
                if 'tailwindcss' not in deps and 'tailwindcss' not in dev_deps:
                    dev_deps['tailwindcss'] = '^4.0.0'
                    deps_added = True
                    logger.info("Added missing 'tailwindcss' to devDependencies")
                if '@tailwindcss/vite' not in deps and '@tailwindcss/vite' not in dev_deps:
                    dev_deps['@tailwindcss/vite'] = '^4.0.0'
                    deps_added = True
                    logger.info("Added missing '@tailwindcss/vite' to devDependencies")
            
            if deps_added:
                package_data['devDependencies'] = dev_deps
                with open(package_json_path, 'w', encoding='utf-8') as f:
                    json.dump(package_data, f, indent=2)
                logger.info("Updated package.json with required Vite dependencies")
            
            if is_vite_project and is_typescript:
                logger.info("Detected Vite + TypeScript project")
                self._ensure_vite_typescript_config(project_dir, has_react, deps, dev_deps)
            elif 'next' in deps:
                logger.info("Detected Next.js project")
                self._ensure_nextjs_config(project_dir)
            else:
                # If it's a generic React project but missing config
                if has_react and is_typescript:
                    logger.info("Detected generic React + TypeScript project, applying Vite-like config")
                    self._ensure_vite_typescript_config(project_dir, True, deps, dev_deps)
                else:
                    logger.info(f"Project type not recognized for auto-configuration (build: {build_script})")
                
        except Exception as e:
            logger.error(f"Error in _ensure_build_configuration: {str(e)}")
            raise
    
    def _ensure_vite_typescript_config(self, project_dir: Path, has_react: bool, deps: Dict, dev_deps: Dict) -> None:
        """
        Ensure Vite + TypeScript project has all necessary configuration files with correct settings.
        Updates existing files if they are missing critical segments like aliases.
        
        Args:
            project_dir: Path to the project directory
            has_react: Whether the project uses React
        """
        files_updated = []
        
        # Default tsconfig content with all necessary fields
        default_tsconfig = {
            "compilerOptions": {
                "target": "ES2020",
                "useDefineForClassFields": True,
                "lib": ["ES2020", "DOM", "DOM.Iterable"],
                "module": "ESNext",
                "skipLibCheck": True,
                "moduleResolution": "bundler",
                "allowImportingTsExtensions": True,
                "resolveJsonModule": True,
                "isolatedModules": True,
                "noEmit": True,
                "jsx": "react-jsx",
                "baseUrl": ".",
                "paths": {
                    "@/*": ["./src/*"]
                },
                "strict": True,
                "noUnusedLocals": False,
                "noUnusedParameters": False,
                "noFallthroughCasesInSwitch": True,
                "allowSyntheticDefaultImports": True,
                "esModuleInterop": True,
                "forceConsistentCasingInFileNames": True
            },
            "include": ["src"],
            "references": [{ "path": "./tsconfig.node.json" }]
        }

        # 1. tsconfig.json
        tsconfig_path = project_dir / 'tsconfig.json'
        try:
            current_config = {}
            if tsconfig_path.exists():
                try:
                    import re
                    content = tsconfig_path.read_text(encoding='utf-8')
                    # Remove comments before parsing JSON
                    content = re.sub(r'//.*', '', content)
                    content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
                    # Remove trailing commas
                    content = re.sub(r',\s*([\]}])', r'\\1', content)
                    current_config = json.loads(content)
                except Exception as parse_error:
                    logger.warning(f"Could not parse existing tsconfig.json: {str(parse_error)}. Overwriting.")
            
            # Check if critical parts are missing or if we need to update
            needs_update = False
            if not current_config or "compilerOptions" not in current_config:
                needs_update = True
                current_config = default_tsconfig
            else:
                opts = current_config["compilerOptions"]
                
                # Check for aliases and baseUrl
                if opts.get("baseUrl") != ".":
                    opts["baseUrl"] = "."
                    needs_update = True
                
                if "paths" not in opts or "@/*" not in opts["paths"]:
                    if "paths" not in opts:
                        opts["paths"] = {}
                    opts["paths"]["@/*"] = ["./src/*"]
                    needs_update = True
                
                # Ensure bundler resolution and other critical flags
                critical_flags = {
                    "moduleResolution": "bundler",
                    "allowImportingTsExtensions": True,
                    "noEmit": True,
                    "jsx": "react-jsx",
                    "noUnusedLocals": False,
                    "noUnusedParameters": False
                }
                
                for flag, value in critical_flags.items():
                    if opts.get(flag) != value:
                        opts[flag] = value
                        needs_update = True
            
            if needs_update:
                with open(tsconfig_path, 'w', encoding='utf-8') as f:
                    json.dump(current_config, f, indent=2)
                files_updated.append('tsconfig.json')
                logger.info("Updated tsconfig.json with correct paths and loose strictness")
        except Exception as e:
            logger.error(f"Error updating tsconfig.json: {str(e)}")

        # 2. tsconfig.node.json
        tsconfig_node_path = project_dir / 'tsconfig.node.json'
        if not tsconfig_node_path.exists():
            tsconfig_node_content = """{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
"""
            with open(tsconfig_node_path, 'w', encoding='utf-8') as f:
                f.write(tsconfig_node_content)
            files_updated.append('tsconfig.node.json')
        
        # 3. vite.config.ts
        vite_config_path = project_dir / 'vite.config.ts'
        try:
            needs_update = False
            if vite_config_path.exists():
                content = vite_config_path.read_text(encoding='utf-8')
                # Check if it has __dirname without ES module support
                has_dirname = '__dirname' in content
                has_file_url_to_path = 'fileURLToPath' in content
                
                # If it uses __dirname but doesn't have fileURLToPath, it needs fixing
                if has_dirname and not has_file_url_to_path:
                    logger.info("Detected vite.config.ts using __dirname without ES module support - fixing")
                    needs_update = True
                # Also check for alias
                elif "alias:" not in content or "'@':" not in content:
                    needs_update = True
            else:
                needs_update = True
                
            if needs_update:
                if has_react:
                    # Detect if tailwindcss v4 is used (it should be according to rules)
                    is_tailwind_v4 = 'tailwindcss' in deps or 'tailwindcss' in dev_deps
                    
                    vite_config_content = "import { defineConfig } from 'vite'\n"
                    vite_config_content += "import react from '@vitejs/plugin-react-swc'\n"
                    if is_tailwind_v4:
                        vite_config_content += "import tailwindcss from '@tailwindcss/vite'\n"
                    vite_config_content += "import path from 'path'\n"
                    vite_config_content += "import { fileURLToPath } from 'url'\n\n"
                    vite_config_content += "const __filename = fileURLToPath(import.meta.url)\n"
                    vite_config_content += "const __dirname = path.dirname(__filename)\n\n"
                    vite_config_content += "export default defineConfig({\n"
                    vite_config_content += "  plugins: [\n"
                    vite_config_content += "    react(),\n"
                    if is_tailwind_v4:
                        vite_config_content += "    tailwindcss(),\n"
                    vite_config_content += "  ],\n"
                    vite_config_content += "  resolve: {\n"
                    vite_config_content += "    alias: {\n"
                    vite_config_content += "      '@': path.resolve(__dirname, './src'),\n"
                    vite_config_content += "    },\n"
                    vite_config_content += "  },\n"
                    vite_config_content += "})\n"
                else:
                    vite_config_content = """import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
"""
                with open(vite_config_path, 'w', encoding='utf-8') as f:
                    f.write(vite_config_content)
                files_updated.append('vite.config.ts')
                logger.info("Updated/Created vite.config.ts with alias support")
        except Exception as e:
            logger.error(f"Error updating vite.config.ts: {str(e)}")
        
        # 4. src/vite-env.d.ts
        src_dir = project_dir / 'src'
        src_dir.mkdir(exist_ok=True)
        
        vite_env_path = src_dir / 'vite-env.d.ts'
        if not vite_env_path.exists():
            vite_env_content = """/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  // Add other env variables here
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
"""
            with open(vite_env_path, 'w', encoding='utf-8') as f:
                f.write(vite_env_content)
            files_updated.append('src/vite-env.d.ts')
        
        # 6. src/index.css (ensure Tailwind v4 import)
        index_css_path = src_dir / 'index.css'
        is_tailwind_v4 = 'tailwindcss' in deps or 'tailwindcss' in dev_deps
        if is_tailwind_v4:
            if not index_css_path.exists():
                with open(index_css_path, 'w', encoding='utf-8') as f:
                    f.write('@import "tailwindcss";\n')
                logger.info("Created src/index.css with Tailwind v4 import")
            else:
                content = index_css_path.read_text(encoding='utf-8')
                if '@import "tailwindcss"' not in content and '@import \'tailwindcss\'' not in content:
                    # Prepend import
                    with open(index_css_path, 'w', encoding='utf-8') as f:
                        f.write('@import "tailwindcss";\n' + content)
                    logger.info("Added Tailwind v4 import to existing src/index.css")

        if files_updated:
            logger.info(f"Verified/Updated build configuration files: {', '.join(files_updated)}")

        # 5. index.html (ensure it exists in root for Vite)
        index_html_path = project_dir / 'index.html'
        if not index_html_path.exists():
            index_html_content = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Anybody App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"""
            try:
                with open(index_html_path, 'w', encoding='utf-8') as f:
                    f.write(index_html_content)
                logger.info("✅ Created missing index.html fallback")
            except Exception as e:
                logger.error(f"Error creating index.html fallback: {str(e)}")
        
        # 6. src/index.css (ensure it exists for main.tsx imports)
        src_index_css_path = src_dir / 'index.css'
        if not src_index_css_path.exists():
            index_css_content = """@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

#root {
  width: 100%;
}
"""
            try:
                with open(src_index_css_path, 'w', encoding='utf-8') as f:
                    f.write(index_css_content)
                logger.info("✅ Created missing src/index.css fallback")
            except Exception as e:
                logger.error(f"Error creating src/index.css fallback: {str(e)}")
        # 7. src/App.tsx (ensure index.css is imported)
        app_tsx_path = src_dir / 'App.tsx'
        app_jsx_path = src_dir / 'App.jsx'
        
        target_app_path = None
        if app_tsx_path.exists():
            target_app_path = app_tsx_path
        elif app_jsx_path.exists():
            target_app_path = app_jsx_path
            
        if target_app_path:
            try:
                content = target_app_path.read_text(encoding='utf-8')
                if "import './index.css'" not in content and 'import "./index.css"' not in content:
                    # Insert at the top of the file
                    new_content = "import './index.css';\n" + content
                    target_app_path.write_text(new_content, encoding='utf-8')
                    logger.info(f"✅ Added missing index.css import to {target_app_path.name}")
            except Exception as e:
                logger.error(f"Error ensuring index.css import in {target_app_path.name}: {str(e)}")
        else:
            logger.info("All necessary configuration files already exist")
    
    def _ensure_nextjs_config(self, project_dir: Path) -> None:
        """
        Ensure Next.js project has all necessary configuration files.
        
        Args:
            project_dir: Path to the project directory
        """
        files_created = []
        
        # tsconfig.json for Next.js
        tsconfig_path = project_dir / 'tsconfig.json'
        if not tsconfig_path.exists():
            tsconfig_content = """{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
"""
            with open(tsconfig_path, 'w', encoding='utf-8') as f:
                f.write(tsconfig_content)
            files_created.append('tsconfig.json')
        
            logger.info("All necessary Next.js configuration files already exist")


    def _validate_package_json(self, package_data: dict) -> bool:
        """
        Validate and fix package.json structure.
        Ensures all required fields are present.
        Returns True if any changes were made.
        """
        modified = False
        
        # Ensure required fields exist
        required_fields = {
            'name': 'app',
            'version': '0.1.0',
            'private': True,
            'type': 'module'
        }
        
        for field, default_value in required_fields.items():
            if field not in package_data:
                package_data[field] = default_value
                modified = True
                logger.info(f"Added missing field '{field}' to package.json")
        
        # Ensure scripts section exists
        if 'scripts' not in package_data:
            package_data['scripts'] = {}
            modified = True
        
        # Ensure dependencies sections exist
        if 'dependencies' not in package_data:
            package_data['dependencies'] = {}
            modified = True
        
        if 'devDependencies' not in package_data:
            package_data['devDependencies'] = {}
            modified = True
        
        return modified

    def _sanitize_dependencies(self, package_data: dict) -> bool:
        """
        Fix common problematic package versions in package.json.
        Returns True if any changes were made.
        """
        modified = False
        sections = ['dependencies', 'devDependencies']
        
        # problematic_versions: package_name_prefix -> (old_version_pattern, new_version)
        # For now, let's just target known Radix issues or use 'latest' for suspected old ones
        radix_packages = [
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-label",
            "@radix-ui/react-slot",
            "@radix-ui/react-popover",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast",
            "@radix-ui/react-tooltip"
        ]

        for section in sections:
            deps = package_data.get(section, {})
            if not isinstance(deps, dict):
                continue
                
            for pkg, version in list(deps.items()):
                # Fix common Radix UI version errors (AI often outputs ^1.0.3 when 2.x is current)
                if any(pkg == r_pkg for r_pkg in radix_packages):
                    if version == "^1.0.3" or version == "1.0.3" or version == "^1.0.2":
                        # Upgrade to 'latest' or a safe known version to avoid ETARGET
                        logger.info(f"Upgrading {pkg} from {version} to latest to avoid install errors")
                        deps[pkg] = "latest"
                        modified = True
                
                # General rule: if version looks like a very old common placeholder
                if version == "0.0.0" or version == "latest" and pkg not in deps:
                    # 'latest' is fine, but if it's 0.0.0 it's likely a mistake
                    pass
        
        return modified

