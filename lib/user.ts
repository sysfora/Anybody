import pb from './pocketbase';

export async function getCurrentUser() {
  try {
    // Check if user is authenticated
    if (!pb.authStore.isValid) {
      throw new Error('User not authenticated');
    }

    // Get current user data
    const user = pb.authStore.model;
    
    if (!user) {
      throw new Error('User data not available');
    }

    return {
      id: user.id,
      username: user.username || user.email?.split('@')[0] || 'user',
      email: user.email,
    };
  } catch (error) {
    console.error('Error getting current user:', error);
    throw error;
  }
}
