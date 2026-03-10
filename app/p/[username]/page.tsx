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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {projects.map((project: RecordModel) => (
                <Card
                  key={project.id}
                  className="rounded-2xl border-border hover:border-primary/50 transition-colors"
                >
                  <CardHeader className="pb-4">
                    <div className="flex items-start justify-between mb-2">
                      <CardTitle className="text-xl font-semibold line-clamp-1">
                        {project.name as string}
                      </CardTitle>
                      {project.deployed && (
                        <Badge variant="outline" className="ml-2 shrink-0">
                          <Eye className="w-3 h-3 mr-1" />
                          Live
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="flex items-center gap-2 text-xs">
                      <Calendar className="w-3 h-3" />
                      {formatDate(project.created as string)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Link 
                      href={`/p/${username}/${project.name as string}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button
                        variant="outline"
                        className="w-full rounded-xl border-border"
                      >
                        View Project
                        <ExternalLink className="w-4 h-4 ml-2" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
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

