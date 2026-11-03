import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrismaEnumSchemas } from '../../shared/src';

describe('Prisma enum contract', () => {
  it('matches every persisted Prisma enum name and value in shared Zod', () => {
    const prisma = readFileSync(
      resolve(process.cwd(), 'server/prisma/schema.prisma'),
      'utf8',
    );
    const prismaEnums = new Map<string, string[]>();
    const pattern = /^enum (\w+) \{([^}]+)\}/gm;
    for (const match of prisma.matchAll(pattern)) {
      prismaEnums.set(
        match[1],
        match[2]
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      );
    }
    expect([...Object.keys(PrismaEnumSchemas)].sort()).toEqual(
      [...prismaEnums.keys()].sort(),
    );
    for (const [name, schema] of Object.entries(PrismaEnumSchemas)) {
      expect([...schema.options], `${name} values`).toEqual(
        prismaEnums.get(name),
      );
    }
  });
});
