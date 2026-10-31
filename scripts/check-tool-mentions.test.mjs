import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkToolMentions, parseToolNames } from './check-tool-mentions.mjs';

const SCRIPT = fileURLToPath(new URL('./check-tool-mentions.mjs', import.meta.url));

// Placeholder names only: the real list lives in the disclosure file of the real repo.
const DISCLOSURE = [
  '# Usage',
  '',
  'We used Acme Writer and Zeta.',
  '',
  '<!-- tool-names: Acme Writer | Zeta -->',
  '',
].join('\n');

const dirs = [];

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function write(root, rel, text) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function commit(root, message) {
  git(root, 'add', '-A');
  git(
    root,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    message,
  );
}

/** A throwaway repository with the disclosure file, one clean file and one commit. */
function makeRepo({ disclosure = DISCLOSURE } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tool-mentions-'));
  dirs.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'core.autocrlf', 'false');
  if (disclosure !== null) write(root, 'AI-USAGE.md', disclosure);
  write(root, '.gitignore', 'ignored/\n');
  write(root, 'README.md', '# Project\n\nNothing to see.\n');
  commit(root, 'chore: start');
  return root;
}

function headSha(root) {
  return git(root, 'rev-parse', 'HEAD').trim();
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('parseToolNames', () => {
  it('reads the names from the marker line', () => {
    expect(parseToolNames(DISCLOSURE)).toEqual(['Acme Writer', 'Zeta']);
  });

  it('throws when the marker is missing', () => {
    expect(() => parseToolNames('# Usage\n\nno marker here\n')).toThrow(/tool-names/);
  });

  it('throws when the marker lists no names', () => {
    expect(() => parseToolNames('<!-- tool-names: | -->')).toThrow(/tool-names/);
  });
});

describe('checkToolMentions', () => {
  it('passes on a clean repository and counts files and commits', async () => {
    const root = makeRepo();
    const result = await checkToolMentions({ root });
    expect(result.ok).toBe(true);
    expect(result.hits).toEqual([]);
    expect(result.files).toBe(2); // .gitignore and README.md; the disclosure file is skipped
    expect(result.commits).toBe(1);
  });

  it('reports a mention in a tracked file with its line', async () => {
    const root = makeRepo();
    write(root, 'src/a.ts', 'const x = 1;\n// drafted with Zeta\n');
    commit(root, 'feat: add a');
    const { ok, hits } = await checkToolMentions({ root });
    expect(ok).toBe(false);
    expect(hits).toEqual([{ where: 'file', ref: 'src/a.ts', line: 2, name: 'Zeta' }]);
  });

  it('reports a mention in an untracked file that is not ignored', async () => {
    const root = makeRepo();
    write(root, 'notes.md', 'Made with acme writer.\n');
    const { hits } = await checkToolMentions({ root });
    expect(hits).toEqual([{ where: 'file', ref: 'notes.md', line: 1, name: 'Acme Writer' }]);
  });

  it('skips ignored files', async () => {
    const root = makeRepo();
    write(root, 'ignored/log.txt', 'Zeta was here\n');
    expect((await checkToolMentions({ root })).ok).toBe(true);
  });

  it('skips the disclosure file itself, the lockfile and binary files', async () => {
    const root = makeRepo();
    write(root, 'package-lock.json', '{ "name": "zeta" }\n');
    writeFileSync(path.join(root, 'logo.bin'), Buffer.from([0x5a, 0x65, 0x74, 0x61, 0x00, 0x01]));
    commit(root, 'chore: add files');
    expect((await checkToolMentions({ root })).ok).toBe(true);
  });

  it('reports a mention in a commit message with the commit sha', async () => {
    const root = makeRepo();
    write(root, 'b.txt', 'b\n');
    commit(root, 'feat: add b\n\nWritten by Zeta.');
    const sha = headSha(root);
    const { hits } = await checkToolMentions({ root });
    expect(hits).toEqual([{ where: 'commit', ref: sha, line: 3, name: 'Zeta' }]);
  });

  it('skips commit messages when includeHistory is false', async () => {
    const root = makeRepo();
    write(root, 'b.txt', 'b\n');
    commit(root, 'feat: add b with Zeta');
    const result = await checkToolMentions({ root, includeHistory: false });
    expect(result.ok).toBe(true);
    expect(result.commits).toBe(0);
  });

  it('matches whole words only, ignoring case', async () => {
    const root = makeRepo();
    write(root, 'c.txt', 'a Zetabyte of data\nZetas everywhere\nmetazeta\nthe ZETA run\n');
    commit(root, 'feat: add c');
    const { hits } = await checkToolMentions({ root });
    expect(hits).toEqual([{ where: 'file', ref: 'c.txt', line: 4, name: 'Zeta' }]);
  });

  it('matches multi-word names literally and not as separate words', async () => {
    const root = makeRepo();
    write(root, 'd.txt', 'Acme and a Writer\nAcme Writers\nACME WRITER\n');
    commit(root, 'feat: add d');
    const { hits } = await checkToolMentions({ root });
    expect(hits).toEqual([{ where: 'file', ref: 'd.txt', line: 3, name: 'Acme Writer' }]);
  });

  it('scans only the given paths when paths are set', async () => {
    const root = makeRepo();
    write(root, 'docs/a.md', 'Zeta\n');
    write(root, 'src/b.ts', '// Zeta\n');
    write(root, 'src/c.mjs', '// Zeta\n');
    commit(root, 'feat: add docs and src');
    const byDir = await checkToolMentions({ root, paths: ['docs'], includeHistory: false });
    expect(byDir.hits.map((h) => h.ref)).toEqual(['docs/a.md']);
    const byGlob = await checkToolMentions({ root, paths: ['src/*.ts'], includeHistory: false });
    expect(byGlob.hits.map((h) => h.ref)).toEqual(['src/b.ts']);
  });

  it('fails loudly when the disclosure file has no marker', async () => {
    const root = makeRepo({ disclosure: '# Usage\n\nNo marker.\n' });
    await expect(checkToolMentions({ root })).rejects.toThrow(/tool-names/);
  });

  it('fails loudly when the disclosure file is missing', async () => {
    const root = makeRepo({ disclosure: null });
    await expect(checkToolMentions({ root })).rejects.toThrow(/AI-USAGE\.md/);
  });
});

describe('CLI', () => {
  function run(root, ...args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
  }

  it('prints a summary and exits 0 when clean', () => {
    const root = makeRepo();
    const res = run(root);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('tool-mention check ok (2 files, 1 commits)');
  });

  it('prints one line per hit and exits 1', () => {
    const root = makeRepo();
    write(root, 'e.txt', 'Zeta\n');
    commit(root, 'feat: add e via Zeta');
    const sha = headSha(root);
    const res = run(root);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('e.txt:1');
    expect(res.stdout).toContain(`commit ${sha.slice(0, 12)}`);
  });

  it('skips history with --no-history', () => {
    const root = makeRepo();
    write(root, 'f.txt', 'f\n');
    commit(root, 'feat: add f via Zeta');
    const res = run(root, '--no-history');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('(3 files, 0 commits)');
  });

  it('limits the scan with --paths', () => {
    const root = makeRepo();
    write(root, 'g/a.txt', 'Zeta\n');
    write(root, 'h/b.txt', 'clean\n');
    commit(root, 'feat: add g and h');
    expect(run(root, '--no-history', '--paths', 'h').status).toBe(0);
    expect(run(root, '--no-history', '--paths', 'g', 'h').status).toBe(1);
  });

  it('exits 1 with a clear message when the marker is missing', () => {
    const root = makeRepo({ disclosure: '# Usage\n' });
    const res = run(root);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/tool-names/);
  });
});
