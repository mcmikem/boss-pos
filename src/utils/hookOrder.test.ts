import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Guards the bug that blanked the Quick Expense modal on the old Android:
 * a hook declared after `if (...) return` runs on one render and not the next,
 * React throws "Rendered more hooks than during the previous render" (#310),
 * and the ErrorBoundary takes the screen.
 *
 * Detected statically with the compiler API, because the two obvious greps both
 * miss it: the return is nested in an `if`, and the hook can be a hundred lines
 * below behind ordinary functions.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = /^use[A-Z]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

function isFunctionNode(node: ts.Node): node is ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression {
  return ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function returnsOnEveryPath(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function earlyReturn(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (ts.isIfStatement(statement)) {
    if (statement.thenStatement && returnsOnEveryPath(statement.thenStatement)) return true;
    if (statement.elseStatement && returnsOnEveryPath(statement.elseStatement)) return true;
  }
  return false;
}

function violationsIn(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  // Parents are never consulted below (getStart takes the source file, and the
  // walk only asks node types) and setting them for a 300KB App.tsx costs more
  // than the whole parse — it was pushing this guard past vitest's 5s limit.
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const at = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const found: string[] = [];

  const visit = (node: ts.Node) => {
    if (isFunctionNode(node) && node.body && ts.isBlock(node.body)) {
      let pastEarlyReturn = false;
      for (const statement of node.body.statements) {
        if (pastEarlyReturn) {
          const scan = (n: ts.Node) => {
            if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOK.test(n.expression.text)) {
              found.push(`${path.relative(SRC, file)}:${at(n)} — ${n.expression.text}() after an early return`);
            }
            ts.forEachChild(n, scan);
          };
          scan(statement);
        }
        if (!pastEarlyReturn && earlyReturn(statement)) pastEarlyReturn = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('hook order', () => {
  it('declares every hook above any early return', () => {
    const violations = walk(SRC).flatMap(violationsIn);
    expect(violations).toEqual([]);
  }, 30000);
});
