import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { readFileSync } from 'fs';
import { join } from 'path';

function loadSlugWords(): string[] {
  try {
    // Try different possible locations for the file
    const possiblePaths = [
      join(process.cwd(), 'Slug-Words.txt'),
      join(process.cwd(), 'Anybody-Frontend', 'Slug-Words.txt'),
      join(process.cwd(), '..', 'Anybody-Frontend', 'Slug-Words.txt'),
    ];

    for (const filePath of possiblePaths) {
      try {
        const fileContent = readFileSync(filePath, 'utf-8');
        const words = fileContent
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0);
        
        if (words.length >= 3) {
          return words;
        }
      } catch (err) {
        // Try next path
        continue;
      }
    }

    // Fallback words if file can't be read
    console.warn('Slug-Words.txt not found, using fallback words');
    return ['modern', 'minimal', 'clean', 'elegant', 'sleek', 'smart', 'fast', 'secure', 'reliable', 'innovative', 'dynamic', 'creative', 'powerful', 'efficient', 'responsive', 'adaptive', 'flexible', 'scalable', 'advanced', 'premium'];
  } catch (error) {
    console.error('Error reading Slug-Words.txt:', error);
    // Fallback words if file can't be read
    return ['modern', 'minimal', 'clean', 'elegant', 'sleek', 'smart', 'fast', 'secure', 'reliable', 'innovative', 'dynamic', 'creative', 'powerful', 'efficient', 'responsive', 'adaptive', 'flexible', 'scalable', 'advanced', 'premium'];
  }
}

function generateProjectName(words: string[]): string {
  // Select 3 random words
  const selectedWords: string[] = [];
  const usedIndices = new Set<number>();
  
  while (selectedWords.length < 3) {
    const randomIndex = Math.floor(Math.random() * words.length);
    if (!usedIndices.has(randomIndex)) {
      usedIndices.add(randomIndex);
      selectedWords.push(words[randomIndex]);
    }
  }
  
  // Join words with hyphens and convert to lowercase
  return selectedWords.join('-').toLowerCase();
}

async function isProjectNameUnique(userId: string, projectName: string): Promise<boolean> {
  try {
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!
    );

    // Check if project name exists for this user in the projects collection
    const existingProjects = await pb.collection('projects').getList(1, 1, {
      filter: `user = "${userId}" && name = "${projectName}"`
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
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Load words from Slug-Words.txt
    const words = loadSlugWords();
    
    if (words.length < 3) {
      return NextResponse.json(
        { error: 'Not enough words in Slug-Words.txt' },
        { status: 500 }
      );
    }

    // Generate a unique project name
    let projectName: string;
    let attempts = 0;
    const maxAttempts = 50;

    do {
      projectName = generateProjectName(words);
      attempts++;
      
      if (attempts >= maxAttempts) {
        // If we can't find a unique name after max attempts, add timestamp
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
      { error: error instanceof Error ? error.message : 'Failed to generate project name' },
      { status: 500 }
    );
  }
}

