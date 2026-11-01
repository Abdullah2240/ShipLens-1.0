import fs from 'node:fs';
import ts from 'typescript';

const LATIN_WORD = /[A-Za-z]+/g;
const TEXT_ATTRIBUTES = new Set(['aria-label', 'placeholder', 'title', 'alt']);

function normalisePath(file) {
  return file.replace(/\\/g, '/');
}

/** True for .tsx sources that are not tests. */
export function shouldScanFile(file) {
  const rel = normalisePath(file);
  if (!rel.endsWith('.tsx')) return false;
  if (/\.test\.tsx$/.test(rel)) return false;
  if (/(^|\/)tests\//.test(rel)) return false;
  return true;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function needsTranslation(text, tokens) {
  let rest = text;
  for (const token of tokens) {
    rest = rest.replace(new RegExp(`(?<![A-Za-z])${escapeRegExp(token)}(?![A-Za-z])`, 'g'), ' ');
  }
  return (rest.match(LATIN_WORD) ?? []).length > 0;
}

function stringValue(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return stringValue(node.expression);
  if (ts.isParenthesizedExpression(node)) return stringValue(node.expression);
  return null;
}

/** Decorative glyphs (aria-hidden="true" or a bare aria-hidden) are not read as text. */
function isAriaHidden(opening, source) {
  return opening.attributes.properties.some((attr) => {
    if (!ts.isJsxAttribute(attr) || attr.name.getText(source) !== 'aria-hidden') return false;
    if (!attr.initializer) return true;
    const value = stringValue(attr.initializer);
    if (value !== null) return value === 'true';
    const expr = ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : null;
    return !!expr && expr.kind === ts.SyntaxKind.TrueKeyword;
  });
}

function scanSource(file, text, tokens) {
  const findings = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const push = (node, value, kind) => {
    const collapsed = value.replace(/\s+/g, ' ').trim();
    if (collapsed && needsTranslation(collapsed, tokens)) {
      findings.push({ file, line: lineOf(node), text: collapsed, kind });
    }
  };

  const visit = (node) => {
    if (ts.isJsxElement(node) && isAriaHidden(node.openingElement, source)) return;
    if (ts.isJsxText(node)) {
      push(node, node.text, 'jsx-text');
    } else if (
      ts.isJsxExpression(node) &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const value = stringValue(node.expression);
      if (value !== null) push(node, value, 'jsx-text');
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      if (TEXT_ATTRIBUTES.has(name)) {
        const value = stringValue(node.initializer);
        if (value !== null) push(node, value, 'attribute');
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/**
 * Hard-coded user-facing text in JSX: text between tags with a Latin letter, bare
 * string-literal children, and string-literal aria-label, placeholder, title and
 * alt values. Text inside aria-hidden elements is decorative and skipped, as are
 * test files, the tests folder, allowlisted files and allowlisted tokens.
 *
 * @param {(string | { file: string, text: string })[]} files paths, or sources given inline
 * @returns {{ file: string, line: number, text: string, kind: 'jsx-text' | 'attribute' }[]}
 */
export function scanJsxText(files, { allowlist = {} } = {}) {
  const tokens = allowlist.tokens ?? [];
  const skippedFiles = new Set((allowlist.files ?? []).map(normalisePath));
  const findings = [];
  for (const entry of files) {
    const file = typeof entry === 'string' ? entry : entry.file;
    const rel = normalisePath(file);
    if (!shouldScanFile(rel) || skippedFiles.has(rel)) continue;
    let text = typeof entry === 'string' ? null : entry.text;
    if (text === null) {
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
    }
    findings.push(...scanSource(rel, text, tokens));
  }
  return findings;
}
