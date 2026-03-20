/**
 * Rewrite absolute asset paths for public preview at `/p/{username}/{projectName}/...`.
 */

export function rewriteAbsolutePaths(
  content: string,
  contentType: string,
  projectId: string
): string {
  try {
    // Only process text-based files
    if (!['text/html', 'text/css', 'application/javascript', 'text/plain'].includes(contentType)) {
      return content;
    }

    // Base path prefix to add
    const pathPrefix = `/p/${projectId}`;
    const targetPattern = `${pathPrefix}/assets/`;
    const hasTargetPattern = content.includes(targetPattern);

    // Remove any existing <base> tag that might interfere with path resolution
    if (contentType === 'text/html') {
      content = content.replace(/<base[^>]*>/gi, '');
    }

    // Collect all paths that would be replaced
    const pathsToReplace: Array<{ type: string; original: string; wouldBecome: string; context?: string }> = [];

    // Find all /assets/ paths (including with file extensions and hashes)
    // Pattern matches: /assets/index-DwaVQZCV.js, /assets/file.css, /assets/GeneratorLogo-mHJgt7ER.png, etc.
    const assetsMatches = [...content.matchAll(/\/assets\/[a-zA-Z0-9_\-\.]+(?:-[a-zA-Z0-9]+)?\.[a-zA-Z0-9]+/g)];

    assetsMatches.forEach((match) => {
      const fullPath = match[0];
      const offset = match.index!;
      
      if (!hasTargetPattern) {
        // Would be replaced
        const contextStart = Math.max(0, offset - 30);
        const contextEnd = Math.min(content.length, offset + fullPath.length + 30);
        const context = content.substring(contextStart, contextEnd);
        
        pathsToReplace.push({
          type: '/assets/ path',
          original: fullPath,
          wouldBecome: `${pathPrefix}${fullPath}`,
          context: context.replace(/\n/g, ' ').substring(0, 100)
        });
      } else {
        // Check if already rewritten
        const contextStart = Math.max(0, offset - 100);
        const context = content.substring(contextStart, offset);
        if (!context.endsWith(pathPrefix) && !context.includes(targetPattern)) {
          const contextEnd = Math.min(content.length, offset + fullPath.length + 30);
          const fullContext = content.substring(contextStart, contextEnd);
          
          pathsToReplace.push({
            type: '/assets/ path',
            original: fullPath,
            wouldBecome: `${pathPrefix}${fullPath}`,
            context: fullContext.replace(/\n/g, ' ').substring(0, 100)
          });
        }
      }
    });

    // Find HTML attribute paths
    const htmlAttrMatches = [...content.matchAll(/((?:src|href|content|data-src|data-href|data-url|action|formaction)=["'])(\/)(?!p\/|api\/)([^"']+)/g)];
    htmlAttrMatches.forEach((match) => {
      const fullMatch = match[0];
      if (!fullMatch.includes('/p/')) {
        const path = match[3];
        pathsToReplace.push({
          type: 'HTML attribute',
          original: path,
          wouldBecome: `${pathPrefix}${path}`,
          context: fullMatch.substring(0, 80)
        });
      }
    });

    // Find CSS url() paths
    const cssUrlMatches = [...content.matchAll(/(url\(["']?)(\/)(?!p\/|api\/)([^"')]+)/g)];
    cssUrlMatches.forEach((match) => {
      const fullMatch = match[0];
      if (!fullMatch.includes('/p/')) {
        const path = match[3];
        pathsToReplace.push({
          type: 'CSS url()',
          original: path,
          wouldBecome: `${pathPrefix}${path}`,
          context: fullMatch.substring(0, 80)
        });
      }
    });

    // Find JavaScript import paths
    const jsImportMatches = [...content.matchAll(/((?:from|import)\s+["'])(\/)(?!p\/|api\/)([^"']+)/g)];
    jsImportMatches.forEach((match) => {
      const fullMatch = match[0];
      if (!fullMatch.includes('/p/')) {
        const path = match[3];
        pathsToReplace.push({
          type: 'JS import',
          original: path,
          wouldBecome: `${pathPrefix}${path}`,
          context: fullMatch.substring(0, 80)
        });
      }
    });

    // Find JavaScript fetch/URL paths
    const jsFetchMatches = [...content.matchAll(/((?:fetch|new\s+URL)\s*\(["'])(\/)(?!p\/|api\/)([^"')]+)/g)];
    jsFetchMatches.forEach((match) => {
      const fullMatch = match[0];
      if (!fullMatch.includes('/p/')) {
        const path = match[3];
        pathsToReplace.push({
          type: 'JS fetch/URL',
          original: path,
          wouldBecome: `${pathPrefix}${path}`,
          context: fullMatch.substring(0, 80)
        });
      }
    });

    // Find JavaScript require paths
    const jsRequireMatches = [...content.matchAll(/(require\s*\(["'])(\/)(?!p\/|api\/)([^"')]+)/g)];
    jsRequireMatches.forEach((match) => {
      const fullMatch = match[0];
      if (!fullMatch.includes('/p/')) {
        const path = match[3];
        pathsToReplace.push({
          type: 'JS require',
          original: path,
          wouldBecome: `${pathPrefix}${path}`,
          context: fullMatch.substring(0, 80)
        });
      }
    });

    // Find CSS @import paths
    const cssImportMatches = [...content.matchAll(/(@import\s+["'])(\/)(?!p\/|api\/)([^"']+)/g)];
    cssImportMatches.forEach((match) => {
      const fullMatch = match[0];
      if (!fullMatch.includes('/p/')) {
        const path = match[3];
        pathsToReplace.push({
          type: 'CSS @import',
          original: path,
          wouldBecome: `${pathPrefix}${path}`,
          context: fullMatch.substring(0, 80)
        });
      }
    });

    // Find other file paths with extensions (in quotes)
    const fileExtMatches = [...content.matchAll(/(["'`])(\/)(?!p\/|api\/)([a-zA-Z0-9_\-\.\/]+\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|mjs|woff|woff2|ttf|eot|mp4|webm|mp3|wav|json|xml|pdf|txt|md))/g)];
    fileExtMatches.forEach((match) => {
      const fullMatch = match[0];
      if (!fullMatch.includes('/p/')) {
        const path = match[3];
        pathsToReplace.push({
          type: 'File with extension (quoted)',
          original: path,
          wouldBecome: `${pathPrefix}${path}`,
          context: fullMatch.substring(0, 80)
        });
      }
    });

    // Find bare absolute paths with file extensions (not in quotes) - very important!
    // This catches paths like: /vite.svg, /assets/index.js, etc.
    // We'll match / followed by filename, then check context to ensure it's not in quotes
    const barePathPattern = /\/([a-zA-Z0-9_\-\.\/]+\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|mjs|woff|woff2|ttf|eot|mp4|webm|mp3|wav|json|xml|pdf|txt|md))/g;
    let barePathMatch;
    while ((barePathMatch = barePathPattern.exec(content)) !== null) {
      const fullPath = barePathMatch[0];
      const offset = barePathMatch.index!;
      
      // Check if this path is already prefixed with /p/ or /api/
      if (fullPath.startsWith('/p/') || fullPath.startsWith('/api/')) {
        continue;
      }
      
      // Check context to see if it's in quotes or already rewritten
      const contextStart = Math.max(0, offset - 100);
      const contextEnd = Math.min(content.length, offset + fullPath.length + 50);
      const context = content.substring(contextStart, contextEnd);
      const relativeOffset = offset - contextStart;
      
      // Check if there's a quote before this path (meaning it's already in a quoted string)
      const beforePath = context.substring(0, relativeOffset);
      const afterPath = context.substring(relativeOffset + fullPath.length);
      
      // If we find matching quotes around this path, skip it (it's already handled by other patterns)
      const lastQuoteBefore = Math.max(
        beforePath.lastIndexOf('"'),
        beforePath.lastIndexOf("'"),
        beforePath.lastIndexOf('`')
      );
      const firstQuoteAfter = Math.min(
        afterPath.indexOf('"') !== -1 ? afterPath.indexOf('"') : Infinity,
        afterPath.indexOf("'") !== -1 ? afterPath.indexOf("'") : Infinity,
        afterPath.indexOf('`') !== -1 ? afterPath.indexOf('`') : Infinity
      );
      
      // If quotes are balanced around this path, it's already in a string - skip
      if (lastQuoteBefore !== -1 && firstQuoteAfter !== Infinity) {
        continue;
      }
      
      // Check if already rewritten
      if (!context.includes('/p/') && !fullPath.includes('/p/')) {
        pathsToReplace.push({
          type: 'Bare absolute path (no quotes)',
          original: fullPath,
          wouldBecome: `${pathPrefix}${fullPath}`,
          context: context.replace(/\n/g, ' ').substring(0, 150)
        });
      }
    }

    // Find paths in script src attributes (might be bare)
    const scriptSrcMatches = [...content.matchAll(/<script[^>]*\ssrc=["']?(\/)(?!p\/|api\/)([^"'>\s]+)/gi)];
    scriptSrcMatches.forEach((match) => {
      const fullMatch = match[0];
      const path = match[2];
      if (!fullMatch.includes('/p/')) {
        pathsToReplace.push({
          type: 'Script src attribute',
          original: `/${path}`,
          wouldBecome: `${pathPrefix}/${path}`,
          context: fullMatch.substring(0, 100)
        });
      }
    });

    // Find paths in link href attributes (might be bare)
    const linkHrefMatches = [...content.matchAll(/<link[^>]*\shref=["']?(\/)(?!p\/|api\/)([^"'>\s]+)/gi)];
    linkHrefMatches.forEach((match) => {
      const fullMatch = match[0];
      const path = match[2];
      if (!fullMatch.includes('/p/')) {
        pathsToReplace.push({
          type: 'Link href attribute',
          original: `/${path}`,
          wouldBecome: `${pathPrefix}/${path}`,
          context: fullMatch.substring(0, 100)
        });
      }
    });

    // Find paths in img src attributes
    const imgSrcMatches = [...content.matchAll(/<img[^>]*\ssrc=["']?(\/)(?!p\/|api\/)([^"'>\s]+)/gi)];
    imgSrcMatches.forEach((match) => {
      const fullMatch = match[0];
      const path = match[2];
      if (!fullMatch.includes('/p/')) {
        pathsToReplace.push({
          type: 'Img src attribute',
          original: `/${path}`,
          wouldBecome: `${pathPrefix}/${path}`,
          context: fullMatch.substring(0, 100)
        });
      }
    });

    // Find any absolute path starting with / that has common asset patterns
    // This is a catch-all for any remaining cases like /vite.svg, /favicon.ico, etc.
    const assetPatternMatches = [...content.matchAll(/\/(assets\/|vite\.|favicon\.|logo\.|icon\.|image\.|img\.|file\.)[a-zA-Z0-9_\-\.]+/g)];
    assetPatternMatches.forEach((match) => {
      const fullPath = match[0];
      const offset = match.index!;
      
      // Skip if already has /p/ or /api/ prefix
      if (fullPath.startsWith('/p/') || fullPath.startsWith('/api/')) {
        return;
      }
      
      // Check context
      const contextStart = Math.max(0, offset - 50);
      const contextEnd = Math.min(content.length, offset + fullPath.length + 50);
      const context = content.substring(contextStart, contextEnd);
      
      // Check if it's in quotes (skip if so, as it's handled by other patterns)
      const beforePath = content.substring(contextStart, offset);
      const afterPath = content.substring(offset + fullPath.length, contextEnd);
      const lastQuote = Math.max(beforePath.lastIndexOf('"'), beforePath.lastIndexOf("'"), beforePath.lastIndexOf('`'));
      const nextQuote = Math.min(
        afterPath.indexOf('"') !== -1 ? afterPath.indexOf('"') : Infinity,
        afterPath.indexOf("'") !== -1 ? afterPath.indexOf("'") : Infinity,
        afterPath.indexOf('`') !== -1 ? afterPath.indexOf('`') : Infinity
      );
      
      // If it's in quotes, skip (handled elsewhere)
      if (lastQuote !== -1 && nextQuote !== Infinity) {
        return;
      }
      
      if (!context.includes('/p/')) {
        pathsToReplace.push({
          type: 'Absolute path (asset pattern)',
          original: fullPath,
          wouldBecome: `${pathPrefix}${fullPath}`,
          context: context.replace(/\n/g, ' ').substring(0, 120)
        });
      }
    });

    // Log all paths that would be replaced
    // Enhanced logging for JS and CSS files
    const isJS = contentType === 'application/javascript';
    const isCSS = contentType === 'text/css';
    const fileTypeEmoji = isJS ? '📜' : isCSS ? '🎨' : '📄';
    const fileTypeName = isJS ? 'JAVASCRIPT' : isCSS ? 'CSS' : contentType.toUpperCase();
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${fileTypeEmoji} Path Rewriting Report for ${fileTypeName} File`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Content Type: ${contentType}`);
    console.log(`Project ID: ${projectId}`);
    console.log(`Path Prefix: ${pathPrefix}`);
    console.log(`Total paths found: ${pathsToReplace.length}`);
    
    if (pathsToReplace.length > 0) {
      // Group by type
      const grouped = pathsToReplace.reduce((acc, item) => {
        if (!acc[item.type]) {
          acc[item.type] = [];
        }
        acc[item.type].push(item);
        return acc;
      }, {} as Record<string, typeof pathsToReplace>);

      console.log(`\n📋 Paths grouped by type:\n`);
      Object.entries(grouped).forEach(([type, items]) => {
        console.log(`  ${type} (${items.length}):`);
        items.forEach((item, idx) => {
          console.log(`    ${idx + 1}. ${item.original}`);
          console.log(`       → ${item.wouldBecome}`);
          if (item.context) {
            // Show more context for JS/CSS files
            const contextPreview = item.context
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r')
              .replace(/\t/g, '\\t')
              .substring(0, isJS || isCSS ? 200 : 100);
            console.log(`       Context: ...${contextPreview}...`);
          }
        });
        console.log(''); // Empty line between groups
      });
      
      // Summary for JS/CSS files
      if (isJS || isCSS) {
        console.log(`\n📊 Summary for ${fileTypeName} file:`);
        console.log(`   - Total unique paths: ${pathsToReplace.length}`);
        console.log(`   - Path types found: ${Object.keys(grouped).length}`);
        console.log(`   - Most common type: ${Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)[0]?.[0] || 'N/A'}`);
        
        // Show examples of paths that will be rewritten
        const examplePaths = pathsToReplace.slice(0, 5);
        if (examplePaths.length > 0) {
          console.log(`\n   Example paths that will be rewritten:`);
          examplePaths.forEach((item, idx) => {
            console.log(`     ${idx + 1}. ${item.original} → ${item.wouldBecome}`);
          });
        }
      }
    } else {
      console.log('\n✅ No paths found that need rewriting.');
    }
    console.log(`\n${'='.repeat(60)}\n`);

    // Now actually perform the replacements
    let rewrittenContent = content;

    // Replace /assets/ paths first (most common case)
    // Check if path already starts with /p/ to avoid double-prefixing
    rewrittenContent = rewrittenContent.replace(
      /\/assets\//g,
      (match, offset, string) => {
        // Check if this /assets/ is already part of a /p/.../assets/ path
        const contextStart = Math.max(0, offset - 200);
        const context = string.substring(contextStart, offset + match.length);
        
        // Check if /p/ appears before this match and forms a complete path
        const pIndex = context.lastIndexOf('/p/');
        if (pIndex !== -1) {
          const pathAfterP = context.substring(pIndex);
          // If we see /p/username/project/assets/, it's already rewritten
          if (pathAfterP.includes('/assets/') && pathAfterP.indexOf('/assets/') > pathAfterP.indexOf('/p/')) {
            return match; // Already rewritten
          }
        }
        
        return targetPattern;
      }
    );

    // Replace HTML attribute paths
    rewrittenContent = rewrittenContent.replace(
      /((?:src|href|content|data-src|data-href|data-url|action|formaction)=["'])(\/)(?!p\/|api\/)([^"']+)/g,
      (match, attr, slash, path) => {
        // Check if path already starts with /p/
        if (path.startsWith('p/') || match.includes(`${pathPrefix}/`)) return match;
        return `${attr}${pathPrefix}${slash}${path}`;
      }
    );

    // Replace CSS url() paths - CRITICAL for CSS files
    rewrittenContent = rewrittenContent.replace(
      /(url\(["']?)(\/)(?!p\/|api\/)([^"')]+)/g,
      (match, urlFunc, slash, path) => {
        // Check if path already starts with /p/
        if (path.startsWith('p/') || match.includes(`${pathPrefix}/`)) return match;
        return `${urlFunc}${pathPrefix}${slash}${path}`;
      }
    );

    // Replace JavaScript import paths
    rewrittenContent = rewrittenContent.replace(
      /((?:from|import)\s+["'])(\/)(?!p\/|api\/)([^"']+)/g,
      (match, importKeyword, slash, path) => {
        // Check if path already starts with /p/
        if (path.startsWith('p/') || match.includes(`${pathPrefix}/`)) return match;
        return `${importKeyword}${pathPrefix}${slash}${path}`;
      }
    );

    // Replace JavaScript fetch/URL paths
    rewrittenContent = rewrittenContent.replace(
      /((?:fetch|new\s+URL)\s*\(["'])(\/)(?!p\/|api\/)([^"')]+)/g,
      (match, func, slash, path) => {
        // Check if path already starts with /p/
        if (path.startsWith('p/') || match.includes(`${pathPrefix}/`)) return match;
        return `${func}${pathPrefix}${slash}${path}`;
      }
    );

    // Replace JavaScript require paths
    rewrittenContent = rewrittenContent.replace(
      /(require\s*\(["'])(\/)(?!p\/|api\/)([^"')]+)/g,
      (match, requireFunc, slash, path) => {
        // Check if path already starts with /p/
        if (path.startsWith('p/') || match.includes(`${pathPrefix}/`)) return match;
        return `${requireFunc}${pathPrefix}${slash}${path}`;
      }
    );

    // Replace CSS @import paths
    rewrittenContent = rewrittenContent.replace(
      /(@import\s+["'])(\/)(?!p\/|api\/)([^"']+)/g,
      (match, importKeyword, slash, path) => {
        // Check if path already starts with /p/
        if (path.startsWith('p/') || match.includes(`${pathPrefix}/`)) return match;
        return `${importKeyword}${pathPrefix}${slash}${path}`;
      }
    );

    // Replace file paths with extensions (in quotes)
    rewrittenContent = rewrittenContent.replace(
      /(["'`])(\/)(?!p\/|api\/)([a-zA-Z0-9_\-\.\/]+\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|mjs|woff|woff2|ttf|eot|mp4|webm|mp3|wav|json|xml|pdf|txt|md))/g,
      (match, quote, slash, path) => {
        // Check if path already starts with /p/
        if (path.startsWith('p/') || match.includes(`${pathPrefix}/`)) return match;
        return `${quote}${pathPrefix}${slash}${path}`;
      }
    );

    // Replace bare absolute paths (not in quotes) - important for JS/CSS
    const barePathReplacePattern = /\/([a-zA-Z0-9_\-\.\/]+\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|mjs|woff|woff2|ttf|eot|mp4|webm|mp3|wav|json|xml|pdf|txt|md))/g;
    rewrittenContent = rewrittenContent.replace(barePathReplacePattern, (match, filename, offset, string) => {
      // Skip if already has /p/ or /api/ prefix
      if (match.startsWith('/p/') || match.startsWith('/api/')) {
        return match;
      }
      
      // Check context to see if path is already prefixed
      const contextStart = Math.max(0, offset - 200);
      const context = string.substring(contextStart, offset + match.length);
      
      // Check if /p/ appears before this match and forms a complete path
      const pIndex = context.lastIndexOf('/p/');
      if (pIndex !== -1) {
        const pathAfterP = context.substring(pIndex);
        // If we see /p/username/project/assets/file, it's already rewritten
        if (pathAfterP.includes(match.substring(1)) && pathAfterP.indexOf(match.substring(1)) > pathAfterP.indexOf('/p/')) {
          return match; // Already rewritten
        }
      }
      
      // Check context to see if it's in quotes
      const relativeOffset = offset - contextStart;
      const beforePath = context.substring(0, relativeOffset);
      const afterPath = context.substring(relativeOffset + match.length);
      
      // Check for balanced quotes
      const lastQuoteBefore = Math.max(
        beforePath.lastIndexOf('"'),
        beforePath.lastIndexOf("'"),
        beforePath.lastIndexOf('`')
      );
      const firstQuoteAfter = Math.min(
        afterPath.indexOf('"') !== -1 ? afterPath.indexOf('"') : Infinity,
        afterPath.indexOf("'") !== -1 ? afterPath.indexOf("'") : Infinity,
        afterPath.indexOf('`') !== -1 ? afterPath.indexOf('`') : Infinity
      );
      
      // If quotes are balanced, it's already in a string - skip (handled by other patterns)
      if (lastQuoteBefore !== -1 && firstQuoteAfter !== Infinity) {
        return match;
      }
      
      return `${pathPrefix}${match}`;
    });

    // Replace script src attributes
    rewrittenContent = rewrittenContent.replace(
      /<script[^>]*\ssrc=["']?(\/)(?!p\/|api\/)([^"'>\s]+)/gi,
      (match, slash, path) => {
        // Check if path already starts with /p/
        if (path.startsWith('p/') || match.includes(`${pathPrefix}/`)) return match;
        return match.replace(`/${path}`, `${pathPrefix}/${path}`);
      }
    );

    // Replace link href attributes
    rewrittenContent = rewrittenContent.replace(
      /<link[^>]*\shref=["']?(\/)(?!p\/|api\/)([^"'>\s]+)/gi,
      (match, slash, path) => {
        // Check if path already starts with /p/
        if (path.startsWith('p/') || match.includes(`${pathPrefix}/`)) return match;
        return match.replace(`/${path}`, `${pathPrefix}/${path}`);
      }
    );

    // Replace img src attributes
    rewrittenContent = rewrittenContent.replace(
      /<img[^>]*\ssrc=["']?(\/)(?!p\/|api\/)([^"'>\s]+)/gi,
      (match, slash, path) => {
        // Check if path already starts with /p/
        if (path.startsWith('p/') || match.includes(`${pathPrefix}/`)) return match;
        return match.replace(`/${path}`, `${pathPrefix}/${path}`);
      }
    );

    // Replace asset pattern paths (vite.svg, favicon.ico, etc.)
    // Only replace if not already prefixed
    rewrittenContent = rewrittenContent.replace(
      /\/(assets\/|vite\.|favicon\.|logo\.|icon\.|image\.|img\.|file\.)[a-zA-Z0-9_\-\.]+/g,
      (match, group, offset, string) => {
        // Skip if already has prefix
        if (match.startsWith('/p/') || match.startsWith('/api/')) {
          return match;
        }
        
        // Check context to see if already prefixed
        const contextStart = Math.max(0, (offset as number) - 200);
        const context = (string as string).substring(contextStart, (offset as number) + match.length);
        const pIndex = context.lastIndexOf('/p/');
        if (pIndex !== -1) {
          const pathAfterP = context.substring(pIndex);
          if (pathAfterP.includes(match.substring(1)) && pathAfterP.indexOf(match.substring(1)) > pathAfterP.indexOf('/p/')) {
            return match; // Already rewritten
          }
        }
        
        return `${pathPrefix}${match}`;
      }
    );

    // Log completion summary for JS/CSS files
    if ((isJS || isCSS) && pathsToReplace.length > 0) {
      const changed = rewrittenContent !== content;
      console.log(`\n${isJS ? '📜' : '🎨'} ${fileTypeName} File Processing Complete:`);
      console.log(`   ✓ Content ${changed ? 'modified' : 'unchanged'}`);
      console.log(`   ✓ ${pathsToReplace.length} path(s) processed`);
      if (changed) {
        console.log(`   ✓ All paths rewritten with prefix: ${pathPrefix}`);
      }
      console.log(`\n${'='.repeat(60)}\n`);
    }

    return rewrittenContent;
  } catch (error) {
    console.warn(`Warning: Failed to analyze paths: ${error}`);
    return content;
  }
}
