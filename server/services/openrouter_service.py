import os
import logging
from openai import OpenAI

logger = logging.getLogger(__name__)

class OpenRouterService:
    """Service for interacting with OpenRouter API"""
    
    def __init__(self):
        self.api_key = os.getenv('OPENROUTER_API_KEY')
        self.base_url = "https://openrouter.ai/api/v1"
        self.default_model = os.getenv('OPENROUTER_MODEL', "anthropic/claude-3.5-haiku")
        
        if not self.api_key:
            logger.warning("OPENROUTER_API_KEY not found in environment variables")
            
        self.client = OpenAI(
            base_url=self.base_url,
            api_key=self.api_key
        )
        
    def generate_chat_response(self, messages, model=None):
        """
        Generate a chat response using OpenRouter
        
        Args:
            messages (list): List of message dictionaries
            model (str, optional): Model to use. Defaults to configured default.
            
        Returns:
            dict: The response object or error dict
        """
        try:
            if not self.api_key:
                return {'error': 'OpenRouter API key not configured'}
                
            model = model or self.default_model
            
            logger.info(f"Sending request to OpenRouter with model: {model}")
            
            completion = self.client.chat.completions.create(
                model=model,
                messages=messages
            )
            
            response_content = completion.choices[0].message.content
            
            return {
                'content': response_content,
                'model': model,
                'role': 'assistant'
            }
            
        except Exception as e:
            logger.error(f"Error calling OpenRouter API: {str(e)}")
            return {'error': str(e)}
