import { useState, useEffect, useCallback, useRef } from 'react';

interface UseProjectPaginationOptions {
  apiUrl: string;
  initialLimit?: number;
}

export function useProjectPagination<T>({ apiUrl, initialLimit = 12 }: UseProjectPaginationOptions) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const loadingRef = useRef(false);

  const fetchMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;

    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const url = new URL(apiUrl, window.location.origin);
      url.searchParams.set('page', page.toString());
      url.searchParams.set('limit', initialLimit.toString());
      url.searchParams.set('perPage', initialLimit.toString()); // Support both naming conventions

      const response = await fetch(url.toString());
      const data = await response.json();

      if (data.success) {
        const newItems = data.projects || [];
        setItems((prev) => [...prev, ...newItems]);
        setHasMore(page < data.totalPages);
        setPage((prev) => prev + 1);
      } else {
        throw new Error(data.error || 'Failed to fetch projects');
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [apiUrl, page, hasMore, initialLimit]);

  // Initial fetch
  useEffect(() => {
    fetchMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { items, loading, hasMore, error, fetchMore };
}
