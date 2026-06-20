import { useState, useEffect, useCallback, useRef } from 'react';

interface UseProjectPaginationOptions<T extends { id: string }> {
  apiUrl: string;
  initialLimit?: number;
  initialItems?: T[];
  initialPage?: number;
  initialHasMore?: boolean;
}

export function useProjectPagination<T extends { id: string }>({
  apiUrl, 
  initialLimit = 12,
  initialItems = [],
  initialPage = 1,
  initialHasMore = true
}: UseProjectPaginationOptions<T>) {
  const [items, setItems] = useState<T[]>(initialItems);
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  
  const loadingRef = useRef(false);

  const fetchMore = useCallback(async () => {
    const trimmedUrl = apiUrl.trim();
    if (loadingRef.current || !hasMore || !trimmedUrl) return;

    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const url = new URL(trimmedUrl, window.location.origin);
      url.searchParams.set('page', page.toString());
      url.searchParams.set('limit', initialLimit.toString());
      url.searchParams.set('perPage', initialLimit.toString());

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new Error('Server returned a non-JSON response');
      }

      const data = await response.json();

      if (data.success) {
        const newItems = (data.projects || []) as T[];
        setItems((prev) => {
          const existingIds = new Set(prev.map((item) => item.id));
          const uniqueNewItems = newItems.filter((item) => !existingIds.has(item.id));
          return [...prev, ...uniqueNewItems];
        });
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

  useEffect(() => {
    if (!apiUrl.trim()) return;
    if (items.length === 0 && hasMore) {
      void fetchMore();
    }
    // Only re-run when the API URL becomes available or changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  return { items, loading, hasMore, error, fetchMore };
}
