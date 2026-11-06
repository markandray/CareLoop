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

  const bannedPatterns = [
    /\bml-\S+/,
    /\bmr-\S+/,
    /\bpl-\S+/,
    /\bpr-\S+/,
    /\btext-left\b/,
    /\btext-right\b/,
    /\bleft-\S+/,
    /\bright-\S+/,
    /\bborder-l\b/,
    /\bborder-l-\S+/,
    /\bborder-r\b/,
    /\bborder-r-\S+/,
    /\brounded-l\b/,
    /\brounded-l-\S+/,
    /\brounded-r\b/,
    /\brounded-r-\S+/,
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
          /\b(left|right)\b/i.test(clsMatch),
          `File ${relativePath} has prohibited directional word in className: "${clsMatch}"`
        ).toBe(false);
      }
    });
  });
});

