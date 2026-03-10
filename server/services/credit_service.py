import os
import logging
from typing import Optional, Dict, Any

try:
    import stripe
    STRIPE_AVAILABLE = True
except ImportError:
    STRIPE_AVAILABLE = False
    stripe = None

from services.pocketbase_service import PocketBaseService

logger = logging.getLogger(__name__)

class CreditService:
    """Service for managing user credits and auto-reload"""
    
    def __init__(self, pocketbase_service: PocketBaseService):
        self.pb_service = pocketbase_service
        self.credit_cost = 10  # Cost per project generation
        
        # Initialize Stripe if available
        if STRIPE_AVAILABLE:
            stripe_key = os.getenv('STRIPE_SECRET_KEY')
            if stripe_key:
                stripe.api_key = stripe_key
            else:
                logger.warning("STRIPE_SECRET_KEY not set, auto-reload will not work")
    
    def check_and_deduct_credits(self, user_id: str) -> Dict[str, Any]:
        """
        Check if user has enough credits and deduct if available.
        If insufficient, attempt auto-reload if enabled.
        
        Args:
            user_id: User ID from PocketBase
            
        Returns:
            Dict with:
            - success: bool
            - message: str (optional)
            - error: str (optional)
            - credits_deducted: bool
            - available_credits: int (after deduction or reload attempt)
        """
        try:
            client = self.pb_service._get_client()
            if not client:
                return {
                    'success': False,
                    'error': 'Could not connect to PocketBase',
                    'credits_deducted': False
                }
            
            # Get user data
            try:
                user = client.collection("users").get_one(user_id)
                # Extract user data
                if hasattr(user, 'credits'):
                    current_credits = getattr(user, 'credits', 0) or 0
                    credits_used = getattr(user, 'credits_used', 0) or 0
                    auto_reload_enabled = getattr(user, 'auto_reload_enabled', False) or False
                    stripe_id = getattr(user, 'stripe_id', None)
                    plan = getattr(user, 'plan', None)
                    reload_amount = getattr(user, 'reload_amount', 10) or 10
                    reload_threshold = getattr(user, 'reload_threshold', 10) or 10
                else:
                    # If it's a dict
                    current_credits = user.get('credits', 0) or 0
                    credits_used = user.get('credits_used', 0) or 0
                    auto_reload_enabled = user.get('auto_reload_enabled', False) or False
                    stripe_id = user.get('stripe_id', None)
                    plan = user.get('plan', None)
                    reload_amount = user.get('reload_amount', 10) or 10
                    reload_threshold = user.get('reload_threshold', 10) or 10
            except Exception as e:
                logger.error(f"Error fetching user {user_id}: {str(e)}")
                return {
                    'success': False,
                    'error': 'User not found',
                    'credits_deducted': False
                }
            
            available_credits = current_credits - credits_used
            
            # Check if user has enough credits
            if available_credits >= self.credit_cost:
                # Deduct credits
                new_credits_used = credits_used + self.credit_cost
                try:
                    client.collection("users").update(user_id, {
                        "credits_used": new_credits_used
                    })
                    logger.info(f"Deducted {self.credit_cost} credits from user {user_id}. Used: {credits_used} -> {new_credits_used}")
                    return {
                        'success': True,
                        'credits_deducted': True,
                        'available_credits': available_credits - self.credit_cost,
                        'message': f'Credits deducted: {self.credit_cost}'
                    }
                except Exception as e:
                    logger.error(f"Error deducting credits: {str(e)}")
                    return {
                        'success': False,
                        'error': 'Failed to deduct credits',
                        'credits_deducted': False
                    }
            
            # Not enough credits - try auto-reload if enabled
            if auto_reload_enabled:
                reload_result = self._attempt_auto_reload(
                    user_id, stripe_id, plan, reload_amount, reload_threshold,
                    current_credits, credits_used, client
                )
                
                if reload_result['success']:
                    # After reload, check again and deduct
                    # Reload updates credits, so we need to recalculate
                    new_available = reload_result.get('new_available_credits', 0)
                    if new_available >= self.credit_cost:
                        # Deduct credits after reload
                        new_credits_used = credits_used + self.credit_cost
                        try:
                            client.collection("users").update(user_id, {
                                "credits_used": new_credits_used
                            })
                            logger.info(f"Deducted {self.credit_cost} credits from user {user_id} after auto-reload. Used: {credits_used} -> {new_credits_used}")
                            return {
                                'success': True,
                                'credits_deducted': True,
                                'available_credits': new_available - self.credit_cost,
                                'message': f'Auto-reload successful. Deducted {self.credit_cost} credits.',
                                'auto_reloaded': True
                            }
                        except Exception as e:
                            logger.error(f"Error deducting credits after reload: {str(e)}")
                            return {
                                'success': False,
                                'error': 'Failed to deduct credits after reload',
                                'credits_deducted': False
                            }
                    else:
                        # Still not enough even after reload
                        return {
                            'success': False,
                            'error': 'insufficient_credits',
                            'credits_deducted': False,
                            'available_credits': new_available,
                            'auto_reloaded': True,
                            'user_plan': plan or 'free',
                            'auto_reload_enabled': True
                        }
                else:
                    # Auto-reload failed - return error with user info
                    return {
                        'success': False,
                        'error': 'insufficient_credits',
                        'credits_deducted': False,
                        'available_credits': available_credits,
                        'auto_reload_failed': True,
                        'user_plan': plan or 'free',
                        'auto_reload_enabled': True
                    }
            else:
                # Auto-reload not enabled - return error with user info
                return {
                    'success': False,
                    'error': 'insufficient_credits',
                    'credits_deducted': False,
                    'available_credits': available_credits,
                    'message': 'Insufficient credits. Please add credits in settings.',
                    'user_plan': plan or 'free',
                    'auto_reload_enabled': False
                }
                
        except Exception as e:
            logger.error(f"Error in check_and_deduct_credits: {str(e)}")
            return {
                'success': False,
                'error': f'Credit check failed: {str(e)}',
                'credits_deducted': False
            }
    
    def _attempt_auto_reload(self, user_id: str, stripe_id: Optional[str], plan: Optional[str],
                            reload_amount: int, reload_threshold: int,
                            current_credits: int, credits_used: int, client: Any) -> Dict[str, Any]:
        """Attempt to auto-reload credits"""
        try:
            if not STRIPE_AVAILABLE:
                return {
                    'success': False,
                    'error': 'Stripe not available'
                }
            
            if not stripe_id:
                return {
                    'success': False,
                    'error': 'No payment method on file'
                }
            
            # Check if user is on Pro plan
            if plan and plan.lower() != 'pro':
                return {
                    'success': False,
                    'error': 'Auto-reload is only available for Pro plan users'
                }
            
            available_credits = current_credits - credits_used
            
            # Check if credits are below threshold
            if available_credits > reload_threshold:
                return {
                    'success': False,
                    'error': 'Credits are above threshold',
                    'new_available_credits': available_credits
                }
            
            # Calculate credits to add: $10 = 500 credits
            credits_to_add = int((reload_amount / 10) * 500)
            
            # Get customer's payment methods
            try:
                payment_methods = stripe.PaymentMethod.list(
                    customer=stripe_id,
                    type='card',
                )
                
                if not payment_methods.data:
                    return {
                        'success': False,
                        'error': 'No payment method on file'
                    }
                
                # Use the first payment method
                payment_method = payment_methods.data[0]
                
                # Create and confirm payment intent
                payment_intent = stripe.PaymentIntent.create(
                    amount=int(reload_amount * 100),  # Convert to cents
                    currency='usd',
                    customer=stripe_id,
                    payment_method=payment_method.id,
                    description=f'Auto-reload: {credits_to_add} credits for ${reload_amount}',
                    metadata={
                        'userId': user_id,
                        'type': 'auto_reload',
                        'credits': str(credits_to_add),
                    },
                    confirm=True,
                    return_url=os.getenv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000') + '/settings',
                )
                
                # If payment succeeded, update credits
                if payment_intent.status == 'succeeded':
                    new_credits = current_credits + credits_to_add
                    
                    client.collection("users").update(user_id, {
                        "credits": new_credits
                    })
                    
                    logger.info(f"Auto-reload successful for user {user_id}: Added {credits_to_add} credits ({current_credits} -> {new_credits})")
                    
                    return {
                        'success': True,
                        'new_available_credits': new_credits - credits_used,
                        'credits_added': credits_to_add,
                        'message': f'Successfully added {credits_to_add} credits'
                    }
                elif payment_intent.status == 'requires_action':
                    return {
                        'success': False,
                        'error': 'Payment requires additional authentication',
                        'requires_action': True,
                        'client_secret': payment_intent.client_secret
                    }
                else:
                    return {
                        'success': False,
                        'error': f'Payment failed with status: {payment_intent.status}'
                    }
                    
            except Exception as stripe_error:
                logger.error(f"Stripe error during auto-reload: {str(stripe_error)}")
                return {
                    'success': False,
                    'error': f'Payment processing failed: {str(stripe_error)}'
                }
                
        except Exception as e:
            logger.error(f"Error in auto-reload attempt: {str(e)}")
            return {
                'success': False,
                'error': f'Auto-reload failed: {str(e)}'
            }

