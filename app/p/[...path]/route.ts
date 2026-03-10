import { NextRequest, NextResponse } from 'next/server';
import { getS3Client, rewriteAbsolutePaths, fetchFileFromR2 } from '@/lib/r2';
import pb from '@/lib/pocketbase';
import { cookies } from 'next/headers';
import type { RecordModel } from 'pocketbase';
import { getEffectiveUserId } from '@/lib/server-utils';

// Helper function to create beautiful error pages
function createErrorPage(status: number, title: string, message: string): NextResponse {
  const getIcon = () => {
    if (status === 404) {
      return '<svg class="w-10 h-10 text-[#737373] dark:text-[#a3a3a3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    }
    if (status === 403) {
      return '<svg class="w-10 h-10 text-[#737373] dark:text-[#a3a3a3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>';
    }
    return '<svg class="w-10 h-10 text-[#737373] dark:text-[#a3a3a3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>';
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Anybody</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
    }
  </script>
  <script>
    (function() {
      try {
        const theme = localStorage.getItem('theme') || 'dark';
        const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (isDark) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      } catch (e) {}
    })();
    
    function toggleTheme() {
      const html = document.documentElement;
      const isDark = html.classList.contains('dark');
      
      if (isDark) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    }
  </style>
</head>
<body class="bg-[#fafafa] dark:bg-[#0a0a0a] flex items-center justify-center min-h-screen p-4 relative">
  <button 
    onclick="toggleTheme()" 
    class="absolute top-4 right-4 inline-flex items-center justify-center w-9 h-9 rounded-2xl border border-[#e5e5e5] dark:border-[#262626] bg-[#ffffff] dark:bg-[#000000] text-[#000000] dark:text-[#ffffff] hover:bg-[#f5f5f5] dark:hover:bg-[#1a1a1a] transition-colors"
    aria-label="Toggle theme"
  >
    <svg class="w-4 h-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>
    </svg>
    <svg class="absolute w-4 h-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path>
    </svg>
  </button>
  <div class="max-w-md w-full text-center">
    <div class="mb-6">
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-[#f0f0f0] dark:bg-[#1a1a1a] mb-4 border border-[#e5e5e5] dark:border-[#262626]">
        ${getIcon()}
      </div>
      <h1 class="text-4xl font-bold text-[#000000] dark:text-[#ffffff] mb-2">${status}</h1>
      <h2 class="text-xl font-semibold text-[#000000] dark:text-[#ffffff] mb-3">${title}</h2>
      <p class="text-[#737373] dark:text-[#a3a3a3] text-sm leading-relaxed">${escapeHtml(message)}</p>
    </div>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
}

// Helper function to escape HTML to prevent XSS
function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {

    // Check for auth token from multiple sources (query param, header, or cookie)
    const { searchParams } = new URL(request.url);
    const tokenFromQuery = searchParams.get('token');
    const authHeader = request.headers.get('authorization');
    const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;

    const cookieStore = await cookies()
    let token: string | null = tokenFromQuery || tokenFromHeader || null;
    let model: RecordModel | null = null;

    // If no token from query/header, try cookie
    if (!token) {
      try {
        const authCookie = cookieStore.get('pocketbase_auth');
        if (authCookie?.value) {
          const authData = JSON.parse(authCookie.value);
          token = authData?.token || null;
          model = authData?.model as RecordModel || null;
        }
      } catch {
        // Cookie doesn't exist or is invalid, token will remain null
      }
    }

    // Check if R2 is configured
    if (!process.env.R2_BUCKET_NAME) {
      return createErrorPage(
        503,
        'Service Unavailable',
        'R2 storage is not configured. Please configure R2_BUCKET_NAME and related settings.'
      );
    }

    // Initialize S3 client
    const s3Client = getS3Client();
    if (!s3Client) {
      return createErrorPage(
        500,
        'Server Error',
        'Failed to initialize R2 connection. Please try again later.'
      );
    }

    // Extract project path from URL
    // URL format: /p/username/projectname/filepath
    const { path } = await params;
    const pathSegments = path;

    if (pathSegments.length < 2) {
      return createErrorPage(
        400,
        'Invalid Project Path',
        'Project path must be in format: username/projectname'
      );
    }

    // Extract username and project name
    const username = pathSegments[0];
    const projectName = pathSegments[1];

    // Get userid from username
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    const users = await pb.collection('users').getList(1, 1, {
      filter: `username = "${username}"`,
    });

    if (users.items.length === 0) {
      return createErrorPage(
        404,
        'User Not Found',
        `User '${username}' does not exist.`
      );
    }

    const userId = users.items[0].id;
    const projectId = `${userId}/${projectName}`;

    // Check if user is logged in by looking for auth token
    // Since localStorage is client-side only, we check query params, headers, or cookies
    let loggedInUserId: string | null = null;
    try {
      if (token && model) {
       try {
          await pb.authStore.save(token, model);
          await pb.collection("users").authRefresh();
          loggedInUserId = pb.authStore.model?.id || null;
        } catch {
          // Token invalid or verification failed
          return createErrorPage(
            401,
            'Unauthorized',
            'Invalid or expired token. Please log in again.'  
          );
        }
      }
    } catch {
      // If there's any error, treat as not logged in
      loggedInUserId = null;
      return createErrorPage(
        500,
        'Unauthorized',
        'Failed to verify user authentication. Please log in again.'
      );
    }

    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Check project visibility and deployment status
    try {
      const projects = await pb.collection('projects').getList(1, 1, {
        filter: `user = "${userId}" && name = "${projectName}"`,
      });

      if (projects.items.length === 0) {
        return createErrorPage(
          404,
          'Project Not Found',
          `Project '${projectName}' does not exist for user '${username}'.`
        );
      }

      const project = projects.items[0];

      // Check if user owns this project or is a team member of the owner
      let isOwner = loggedInUserId === userId;
      
      // If not direct owner, check if logged-in user is a team member
      if (!isOwner && loggedInUserId) {
        try {
          const effectiveUserId = await getEffectiveUserId(loggedInUserId);
          // If the effective user ID (owner) matches the project owner, user has access
          isOwner = effectiveUserId === userId;
        } catch {
          // Error checking team membership, treat as not owner
          isOwner = false;
        }
      }

      // Check if project is accessible
      const isPublic = project.visibility === 'public';
      const isDeployed = project.deployed === true;

      // Allow access if: owner OR public OR deployed
      if (!isOwner && !isPublic && !isDeployed) {
        return createErrorPage(
          403,
          'Access Denied',
          'This project is private and not deployed. You do not have permission to view it.'
        );
      }
    } catch (error) {
      console.error('Error checking project access:', error);
      return createErrorPage(
        500,
        'Server Error',
        'Failed to verify project access. Please try again later.'
      );
    }

    // Get file path (everything after username/projectname)
    const filePath = pathSegments.slice(2).join('/') || 'index.html';

    // Construct the R2 key for the file in the dist folder
    // Format: {projectId}/dist/{filePath} where projectId is userid/projectname
    const r2Key = `${projectId}/dist/${filePath}`;

    try {
      // Fetch the file from R2
      const { content, contentType } = await fetchFileFromR2(
        s3Client,
        process.env.R2_BUCKET_NAME,
        r2Key
      );

      // Check if this is a binary file that shouldn't be processed
      const isBinaryFile = !['text/html', 'text/css', 'application/javascript', 'text/plain'].includes(contentType);

      if (isBinaryFile) {
        // Return binary files directly without processing
        return new NextResponse(new Uint8Array(content), {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
        });
      }

      // Rewrite absolute paths in text-based files
      // Use username/projectname for public URLs (not userid)
      const publicPath = `${username}/${projectName}`;
      const processedContent = rewriteAbsolutePaths(
        content.toString('utf-8'),
        contentType,
        publicPath
      );

      // Return the file with appropriate content type
      return new NextResponse(processedContent, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });

    } catch (error) {
      // If the file is not found and it's a directory-like path (no extension),
      // try to serve index.html from that directory
      if (error instanceof Error && error.message === 'File not found' && !filePath.includes('.')) {
        try {
          const indexKey = `${projectId}/dist/${filePath}/index.html`;
          const { content } = await fetchFileFromR2(
            s3Client,
            process.env.R2_BUCKET_NAME,
            indexKey
          );

          // Use username/projectname for public URLs (not userid)
          const publicPath = `${username}/${projectName}`;
          const processedContent = rewriteAbsolutePaths(
            content.toString('utf-8'),
            'text/html',
            publicPath
          );

          return new NextResponse(processedContent, {
            status: 200,
            headers: {
              'Content-Type': 'text/html',
              'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0',
            },
          });
        } catch {
          // Fall through to 404 error
        }
      }

      // Return 404 for file not found
      if (error instanceof Error && error.message === 'File not found') {
        return createErrorPage(
          404,
          'File Not Found',
          `The requested file does not exist in project '${username}/${projectName}'.`
        );
      }

      // Return 500 for other errors
      return createErrorPage(
        500,
        'Server Error',
        error instanceof Error ? error.message : 'An unknown error occurred while fetching the file.'
      );
    }

  } catch (error) {
    return createErrorPage(
      500,
      'Internal Server Error',
      error instanceof Error ? error.message : 'An unexpected error occurred. Please try again later.'
    );
  }
}
