import { useState, useEffect, useCallback, useRef } from 'react';

interface UseProjectPaginationOptions<T> {
  apiUrl: string;
  initialLimit?: number;
  initialItems?: T[];
  initialPage?: number;
  initialHasMore?: boolean;
}

export function useProjectPagination<T>({ 
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
        setItems((prev) => {
          // Filter out duplicates if any (by id)
          const existingIds = new Set(prev.map((item: any) => item.id));
          const uniqueNewItems = newItems.filter((item: any) => !existingIds.has(item.id));
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

  // Initial fetch only if we don't have items yet
  useEffect(() => {
    if (items.length === 0 && hasMore) {
      fetchMore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { items, loading, hasMore, error, fetchMore };
}
