import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';

function generateRandomUsername(fullName: string): string {
  // Clean the full name and split into parts
  const nameParts = fullName
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(part => part.length > 0);

  if (nameParts.length === 0) {
    return `user${Math.floor(Math.random() * 10000)}`;
  }

  // Generate different username patterns
  const patterns = [
    // First name + last name + random number
    () => `${nameParts[0]}${nameParts[nameParts.length - 1]}${Math.floor(Math.random() * 1000)}`,
    // First name + random number
    () => `${nameParts[0]}${Math.floor(Math.random() * 10000)}`,
    // First initial + last name + random number
    () => `${nameParts[0][0]}${nameParts[nameParts.length - 1]}${Math.floor(Math.random() * 1000)}`,
    // First name + middle initial + last name + random number
    () => nameParts.length > 2 
      ? `${nameParts[0]}${nameParts[1][0]}${nameParts[nameParts.length - 1]}${Math.floor(Math.random() * 100)}`
      : `${nameParts[0]}${nameParts[nameParts.length - 1]}${Math.floor(Math.random() * 1000)}`,
    // All initials + random number
    () => `${nameParts.map(part => part[0]).join('')}${Math.floor(Math.random() * 1000)}`,
  ];

  // Try each pattern until we find a unique username
  for (const pattern of patterns) {
    const username = pattern();
    if (username.length >= 3 && username.length <= 20) {
      return username;
    }
  }

  // Fallback to a simple pattern
  return `${nameParts[0]}${Math.floor(Math.random() * 10000)}`;
}

async function isUsernameUnique(username: string): Promise<boolean> {
  try {
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Check if username exists in the users collection
    const existingUsers = await pb.collection('users').getList(1, 1, {
      filter: `username = "${username}"`
    });

    return existingUsers.items.length === 0;
  } catch (error) {
    console.error('Error checking username uniqueness:', error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fullName } = body;

    if (!fullName || typeof fullName !== 'string') {
      return NextResponse.json(
        { error: 'Full name is required' },
        { status: 400 }
      );
    }

    // Generate a unique username
    let username: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      username = generateRandomUsername(fullName);
      attempts++;
      
      if (attempts >= maxAttempts) {
        // If we can't find a unique username after max attempts, add timestamp
        username = `${username}${Date.now().toString().slice(-4)}`;
        break;
      }
    } while (!(await isUsernameUnique(username)));

    return NextResponse.json({
      success: true,
      username,
    });
  } catch (error: unknown) {
    console.error('Username generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate username' },
      { status: 500 }
    );
  }
}
