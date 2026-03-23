import { NextRequest, NextResponse } from 'next/server';
import pb from '@/lib/pocketbase';
import { getEffectiveUserId } from '@/lib/server-utils';
import { escapePbFilterString, getSessionRecord } from '@/lib/session-user';

export const dynamic = 'force-dynamic';

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** When PB saved `html` but assistant `content` is empty, show readable text like before refresh. */
function synthesizeAssistantSummaryFromHtml(html: string): string {
  const stripInner = (frag: string) =>
    decodeBasicEntities(frag.replace(/<[^>]+>/g, ' ')).slice(0, 400);

  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripInner(titleM[1]) : '';
  if (title) {
    return `Generated page: “${title}”. Use the code and preview panes for the full HTML.`;
  }
  const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = h1M ? stripInner(h1M[1]) : '';
  if (h1) {
    return `“${h1}”\n\nFull HTML is in the code and preview panels.`;
  }
  return 'Generated HTML is available in the code and preview panels.';
}

function htmlLooksSubstantial(h: string): boolean {
  const t = h.trim();
  return t.length >= 60;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionRecord();
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectName = (searchParams.get('projectName') || '').trim();
    if (!projectName) {
      return NextResponse.json(
        { error: 'projectName is required' },
        { status: 400 },
      );
    }

    await pb.admins.authWithPassword(
      process.env.POCKETBASE_SUPERADMIN_EMAIL!,
      process.env.POCKETBASE_SUPERADMIN_PASSWORD!,
    );

    const effectiveUserId = await getEffectiveUserId(session.id);
    const safeName = escapePbFilterString(projectName);

    const projects = await pb.collection('projects').getList(1, 1, {
      filter: `user = "${effectiveUserId}" && name = "${safeName}"`,
    });

    if (projects.items.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = projects.items[0] as unknown as {
      id: string;
      name: string;
      visibility?: string;
      status?: string;
      deployed?: boolean;
      html?: string;
    };

    let html =
      typeof project.html === 'string' && project.html.trim() ? project.html : '';

    const safeProjectId = escapePbFilterString(project.id);
    let messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      thinking: string;
      created: string;
      request_id: string;
    }> = [];

    /** PocketBase list items are plain objects; avoid JSON.stringify (can drop fields on some SDK shapes). */
    const pickStr = (obj: Record<string, unknown>, keys: string[]): string => {
      for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'string') return v;
      }
      return '';
    };

    try {
      const messageRows = await pb.collection('project_messages').getFullList({
        filter: `project = "${safeProjectId}"`,
        sort: 'created',
      });
      messages = messageRows.map((row: unknown) => {
        const flat =
          row && typeof row === 'object'
            ? ({ ...(row as Record<string, unknown>) } as Record<string, unknown>)
            : {};
        const id = typeof flat.id === 'string' ? flat.id : '';
        const roleRaw = pickStr(flat, ['role', 'Role']);
        const content = pickStr(flat, [
          'content',
          'Content',
          'message',
          'Message',
          'body',
          'Body',
          'text',
          'Text',
        ]);
        const thinking = pickStr(flat, [
          'thinking',
          'Thinking',
          'reasoning',
          'Reasoning',
        ]);
        const created =
          pickStr(flat, ['created', 'Created']) || new Date().toISOString();
        const request_id = pickStr(flat, ['request_id', 'requestId']);
        return {
          id,
          role: roleRaw === 'user' ? 'user' : 'assistant',
          content,
          thinking,
          created,
          request_id,
        };
      });
    } catch {
      // Collection may not exist until PocketBase is migrated; HTML still loads.
    }

    messages = messages.map((m) => ({ ...m }));
    let synthesizedLastAssistant = false;
    let extractedHtml = '';

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== 'assistant') continue;
      
      if (!html && !extractedHtml) {
        const match = messages[i].content.match(/```(?:html)?\s*(<!DOCTYPE html>[\s\S]*?|<html>[\s\S]*?)```/i) || 
                      messages[i].content.match(/```(?:html)?\s*([\s\S]*?)```/i);
        if (match && match[1]) {
          extractedHtml = match[1].trim();
        }
      }

      if (
        !messages[i].content.trim() &&
        (html || extractedHtml) &&
        htmlLooksSubstantial(html || extractedHtml)
      ) {
        messages[i] = {
          ...messages[i],
          content: synthesizeAssistantSummaryFromHtml(html || extractedHtml),
        };
        synthesizedLastAssistant = true;
      }
      break;
    }
    
    html = html || extractedHtml;

    let responseStatus = project.status ?? 'completed';
    if (synthesizedLastAssistant && responseStatus === 'generating') {
      responseStatus = 'completed';
    }

    return NextResponse.json({
      success: true,
      project: {
        id: project.id,
        name: project.name,
        visibility: project.visibility ?? 'public',
        status: responseStatus,
        deployed: project.deployed ?? false,
      },
      html,
      messages,
    });
  } catch (error) {
    console.error('projects/load:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load project' },
      { status: 500 },
    );
  }
}
