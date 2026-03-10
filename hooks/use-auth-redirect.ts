import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import pb from '@/lib/pocketbase';

export function useAuthRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Check if user is authenticated
    if (!pb.authStore.isValid || !pb.authStore.model) {
      router.push('/login');
    }
  }, [router]);
}

