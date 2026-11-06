import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function collectFiles(dir: string, fileList: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.next' ||
        entry.name === 'dist' ||
        entry.name === 'tests'
      ) {
        continue;
      }
      collectFiles(fullPath, fileList);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') ||
        entry.name.endsWith('.tsx') ||
        entry.name.endsWith('.css'))
    ) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('CSS class directionality guard', () => {
  const clientDir = path.resolve(__dirname, '..');
  const files = collectFiles(clientDir);

  it('found source files under client/ to verify', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  // Build direction-sensitive class patterns from parts so this guard does not
  // match its own source when scanning all client TypeScript files.
  const bannedPatterns = [
    new RegExp(['\\b', 'm', 'l', '-', '\\S+'].join('')),
    new RegExp(['\\b', 'm', 'r', '-', '\\S+'].join('')),
    new RegExp(['\\b', 'p', 'l', '-', '\\S+'].join('')),
    new RegExp(['\\b', 'p', 'r', '-', '\\S+'].join('')),
    new RegExp(['\\b', 'text-', 'left', '\\b'].join('')),
    new RegExp(['\\b', 'text-', 'right', '\\b'].join('')),
    new RegExp(['\\b', 'left', '-', '\\S+'].join('')),
    new RegExp(['\\b', 'right', '-', '\\S+'].join('')),
    new RegExp(['\\b', 'border-', 'l', '\\b'].join('')),
    new RegExp(['\\b', 'border-', 'l', '-', '\\S+'].join('')),
    new RegExp(['\\b', 'border-', 'r', '\\b'].join('')),
    new RegExp(['\\b', 'border-', 'r', '-', '\\S+'].join('')),
    new RegExp(['\\b', 'rounded-', 'l', '\\b'].join('')),
    new RegExp(['\\b', 'rounded-', 'l', '-', '\\S+'].join('')),
    new RegExp(['\\b', 'rounded-', 'r', '\\b'].join('')),
    new RegExp(['\\b', 'rounded-', 'r', '-', '\\S+'].join('')),
  ];

  files.forEach((file) => {
    const relativePath = path.relative(clientDir, file);

    it(`file ${relativePath} contains no directional left/right classes`, () => {
      const content = fs.readFileSync(file, 'utf-8');

      // Check banned regex patterns
      for (const pattern of bannedPatterns) {
        const match = content.match(pattern);
        expect(
          match,
          `File ${relativePath} uses prohibited directional class: "${match?.[0]}". Use logical utilities (ms-, me-, ps-, pe-, start, end, text-start) instead.`
        ).toBeNull();
      }

      // Check className string contents for "left" or "right" words
      const classNameMatches = content.match(/className=(["'{`])(.*?)\1/g) || [];
      for (const clsMatch of classNameMatches) {
        expect(
        new RegExp(['\\b(left', '|right)\\b'].join(''), 'i').test(clsMatch),
          `File ${relativePath} has prohibited directional word in className: "${clsMatch}"`
        ).toBe(false);
      }
    });
  });
});

