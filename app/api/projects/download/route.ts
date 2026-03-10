import { NextRequest, NextResponse } from 'next/server';
import { getS3Client, fetchFileFromR2 } from '@/lib/r2';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import pb from '@/lib/pocketbase';
import archiver from 'archiver';
import { Readable } from 'stream';
import Stripe from 'stripe';
import { getEffectiveUserId } from '@/lib/server-utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-11-17.clover',
});

async function createZip(files: Array<{ path: string; content: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    archive.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    
    archive.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    
    archive.on('error', (err) => {
      reject(err);
    });
    
    // Add all files to the archive
    for (const file of files) {
      archive.append(Readable.from(file.content), { name: file.path });
    }
    
    archive.finalize();
  });
}

export async function POST(request: NextRequest) {
  try {
    const { username, userId: providedUserId, projectName } = await request.json();

    if (!projectName) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      );
    }

    if (!username && !providedUserId) {
      return NextResponse.json(
        { error: 'Username or userId is required' },
        { status: 400 }
      );
    }

    // Check if R2 is configured
    if (!process.env.R2_BUCKET_NAME) {
      return NextResponse.json(
        { error: 'R2 storage is not configured' },
        { status: 503 }
      );
    }

    // Initialize S3 client
    const s3Client = getS3Client();
    if (!s3Client) {
      return NextResponse.json(
        { error: 'Failed to initialize R2 connection' },
        { status: 500 }
      );
    }

    // Authenticate as admin
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Get userId - either use provided userId or look up by username
    let userId: string;
    if (providedUserId) {
      // Verify user exists
      try {
        await pb.collection('users').getOne(providedUserId);
        userId = providedUserId;
      } catch {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }
    } else {
      // Look up by username
      const users = await pb.collection('users').getList(1, 1, {
        filter: `username = "${username}"`,
      });

      if (users.items.length === 0) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }

      userId = users.items[0].id;
    }
    
    // Get effective user ID (owner ID if team member, otherwise user's own ID)
    const effectiveUserId = await getEffectiveUserId(userId);

    // Check subscription and credits for download permission
    const user = await pb.collection('users').getOne(effectiveUserId);
    const stripeCustomerId = user.stripe_id;

    if (!stripeCustomerId) {
      return NextResponse.json(
        { error: 'Subscription required to download projects' },
        { status: 403 }
      );
    }

    // Get active subscriptions from Stripe
    const subscriptions = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return NextResponse.json(
        { error: 'Subscription required to download projects' },
        { status: 403 }
      );
    }

    const subscription = subscriptions.data[0];
    const isActive = subscription.status === 'active' || subscription.status === 'trialing';

    if (!isActive) {
      return NextResponse.json(
        { error: 'Active subscription required to download projects' },
        { status: 403 }
      );
    }

    const projectId = `${effectiveUserId}/${projectName}`;
    const sourcePrefix = `${projectId}/source/`;

    // List all files in the source directory
    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: sourcePrefix,
    });

    const listResponse = await s3Client.send(listCommand);
    const files = (listResponse.Contents || [])
      .map((item) => item.Key || '')
      .filter((key) => key.length > 0 && !key.endsWith('/')); // Filter out directories

    if (files.length === 0) {
      return NextResponse.json(
        { error: 'No source files found' },
        { status: 404 }
      );
    }

    // Download all files
    const fileData: Array<{ path: string; content: Buffer }> = [];
    
    for (const fileKey of files) {
      try {
        const { content } = await fetchFileFromR2(
          s3Client,
          process.env.R2_BUCKET_NAME!,
          fileKey
        );
        
        // Get relative path (remove the source prefix)
        const relativePath = fileKey.replace(sourcePrefix, '');
        fileData.push({ path: relativePath, content });
      } catch (error) {
        console.error(`Error downloading file ${fileKey}:`, error);
        // Continue with other files even if one fails
      }
    }

    if (fileData.length === 0) {
      return NextResponse.json(
        { error: 'Failed to download any files' },
        { status: 500 }
      );
    }

    // Create ZIP file
    const zipBuffer = await createZip(fileData);

    // Return ZIP file as download
    return new NextResponse(zipBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${projectName}.zip"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Error creating download ZIP:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

