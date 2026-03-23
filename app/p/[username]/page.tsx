import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { RecordModel } from 'pocketbase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { ExternalLink, Calendar, Eye } from 'lucide-react';
import Link from 'next/link';

interface UserProjectsPageProps {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ page?: string }>;
}

interface PublicProjectsResponse {
  success: boolean;
  projects: RecordModel[];
  totalItems: number;
  totalPages: number;
  page: number;
  perPage: number;
  username: string;
}

async function getUserPublicProjects(
  username: string,
  page: number = 1,
  perPage: number = 50
): Promise<PublicProjectsResponse | null> {
  try {
    const headersList = await headers();
    const host = headersList.get('host') || 'localhost:3000';
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const baseUrl = `${protocol}://${host}`;

    const response = await fetch(
      `${baseUrl}/api/users/${username}/public-projects?page=${page}&perPage=${perPage}`,
      {
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error('Failed to fetch public projects');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching public projects:', error);
    return null;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `${username}'s Public Projects - Anybody.dev`,
    description: `Browse ${username}'s public projects on Anybody.dev`,
  };
}

export default async function UserProjectsPage({
  params,
  searchParams,
}: UserProjectsPageProps) {
  const { username } = await params;
  const { page: pageParam } = await searchParams;
  const currentPage = parseInt(pageParam || '1', 10);

  const data = await getUserPublicProjects(username, currentPage, 50);

  if (!data) {
    notFound();
  }

  const { projects, totalItems, totalPages, page, username: userUsername } = data;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">{userUsername}&apos;s Projects</h1>
          <p className="text-muted-foreground">
            {totalItems} {totalItems === 1 ? 'public project' : 'public projects'}
          </p>
        </div>

        {projects.length === 0 ? (
          <Card className="rounded-2xl border-border">
            <CardContent className="p-12 text-center">
              <p className="text-muted-foreground text-lg">
                No public projects found for this user.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {projects.map((project: RecordModel) => {
                const previewUrl = project.preview
                  ? `${process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090'}/api/files/projects/${project.id}/${project.preview}`
                  : null;

                return (
                  <Card
                    key={project.id}
                    className="rounded-2xl border-border hover:border-primary/50 hover:shadow-md transition-all overflow-hidden flex flex-col group"
                  >
                    <Link
                      href={`/p/${username}/${project.name as string}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col h-full"
                    >
                      <div className="relative aspect-video w-full overflow-hidden border-b border-border bg-muted/50">
                        {previewUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={previewUrl}
                            alt={`${project.name} preview`}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent to-secondary/10 group-hover:opacity-80 transition-opacity" />
                        )}

                        {project.deployed && (
                          <div className="absolute top-3 left-3 shadow-md rounded-full bg-background/80 backdrop-blur-sm px-2.5 py-1 flex items-center gap-1.5 text-xs font-semibold border border-border">
                            <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                            Live
                          </div>
                        )}
                      </div>

                      <div className="p-5 flex flex-col flex-1">
                        <h3 className="text-xl font-semibold line-clamp-1 mb-2">
                          {project.name as string}
                        </h3>
                        <div className="flex items-center text-sm text-muted-foreground gap-1.5 mt-auto pt-1">
                          <Calendar className="w-4 h-4" />
                          {formatDate(project.created as string)}
                        </div>
                      </div>
                    </Link>
                  </Card>
                );
              })}
            </div>

            {totalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  {page > 1 && (
                    <PaginationItem>
                      <PaginationPrevious
                        href={`/p/${username}?page=${page - 1}`}
                      />
                    </PaginationItem>
                  )}

                  {(() => {
                    const pages: (number | 'ellipsis')[] = [];

                    if (totalPages <= 7) {
                      for (let i = 1; i <= totalPages; i++) {
                        pages.push(i);
                      }
                    } else {
                      pages.push(1);

                      if (page > 3) {
                        pages.push('ellipsis');
                      }

                      const start = Math.max(2, page - 1);
                      const end = Math.min(totalPages - 1, page + 1);

                      for (let i = start; i <= end; i++) {
                        if (i !== 1 && i !== totalPages) {
                          pages.push(i);
                        }
                      }

                      if (page < totalPages - 2) {
                        pages.push('ellipsis');
                      }

                      pages.push(totalPages);
                    }

                    return pages.map((item, index) => {
                      if (item === 'ellipsis') {
                        return (
                          <PaginationItem key={`ellipsis-${index}`}>
                            <PaginationEllipsis />
                          </PaginationItem>
                        );
                      }
                      return (
                        <PaginationItem key={item}>
                          <PaginationLink
                            href={`/p/${username}?page=${item}`}
                            isActive={item === page}
                            className="rounded-xl"
                          >
                            {item}
                          </PaginationLink>
                        </PaginationItem>
                      );
                    });
                  })()}

                  {page < totalPages && (
                    <PaginationItem>
                      <PaginationNext href={`/p/${username}?page=${page + 1}`} />
                    </PaginationItem>
                  )}
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}
      </div>
    </div>
  );
}

