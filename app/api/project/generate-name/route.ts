import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { loadSlugWords, randomSlugFromWords } from '@/lib/slug-words';

async function isProjectNameUnique(
  userId: string,
  projectName: string,
): Promise<boolean> {
  try {
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!,
    );

    const existingProjects = await pb.collection('projects').getList(1, 1, {
      filter: `user = "${userId}" && name = "${projectName}"`,
    });

    return existingProjects.items.length === 0;
  } catch (error) {
    console.error('Error checking project name uniqueness:', error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const words = loadSlugWords();

    if (words.length < 3) {
      return NextResponse.json(
        { error: 'Not enough words in Slug-Words.txt' },
        { status: 500 },
      );
    }

    let projectName: string;
    let attempts = 0;
    const maxAttempts = 50;

    do {
      projectName = randomSlugFromWords(words);
      attempts++;

      if (attempts >= maxAttempts) {
        projectName = `${projectName}-${Date.now().toString().slice(-6)}`;
        break;
      }
    } while (!(await isProjectNameUnique(userId, projectName)));

    return NextResponse.json({
      success: true,
      projectName,
    });
  } catch (error: unknown) {
    console.error('Project name generation error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to generate project name',
      },
      { status: 500 },
    );
  }
}
