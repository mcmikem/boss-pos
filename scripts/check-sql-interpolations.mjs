// Catches the bug class that broke five endpoints at once.
//
// In a tagged template like sql`... ${x} ...`, the interpolations are JAVASCRIPT.
// Writing SQL inside one — `${status === 'submitted' ? at : e.submitted_at}` or
// `${nextStatus === 'settled' ? at : settlement_movements.settled_at}` — makes
// the JS engine evaluate `e.submitted_at` and `settlement_movements.settled_at`
// as identifiers. Neither is declared, so every request through that handler
// throws a ReferenceError, the global handler turns it into a 500, and nothing
// is written. Type checks do not see it and unit tests do not reach it.
//
// So: collect every name the file declares, then flag any identifier used inside
// an `sql` interpolation that the file never declares. A SQL column or table
// name leaking into a template is exactly that.
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node scripts/check-sql-interpolations.mjs <file...>');
  process.exit(2);
}

const GLOBALS = new Set([
  'Math', 'JSON', 'Date', 'Number', 'String', 'Object', 'Array', 'Boolean', 'RegExp', 'Error', 'Map', 'Set',
  'Promise', 'Symbol', 'BigInt', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'undefined', 'NaN', 'Infinity', 'globalThis', 'console', 'process', 'Buffer',
  'structuredClone', 'Intl', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'URL', 'URLSearchParams',
  'TextEncoder', 'TextDecoder', 'AbortController', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'require', 'module', 'exports', '__dirname', '__filename', 'crypto', 'queueMicrotask',
  // keywords, which are never the bug
  'new', 'null', 'true', 'false', 'this', 'typeof', 'void', 'delete', 'in', 'of', 'instanceof',
]);

// String and template contents are data, not identifiers.
function stripLiterals(expr) {
  return expr
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const problems = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');

  // --- every name this file declares, at any depth -----------------------
  const declared = new Set();
  const add = (n) => { if (n) declared.add(n); };
  for (const m of src.matchAll(/\b(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // destructuring: const { a, b: c } = ... / const [a, b] = ...
  for (const m of src.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().split('=')[0].replace(/\.\.\./, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name);
    }
  }
  // parameters, and catch bindings
  for (const m of src.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split('=')[0].split(':').pop().replace(/\.\.\./, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name);
    }
  }
  for (const m of src.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/\bimport\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?/g)) {
    add(m[1]);
    for (const part of (m[2] || '').split(',')) {
      const name = part.split(/\bas\b/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name);
    }
  }

  // --- every interpolation inside a sql`...` template ---------------------
  const lineOf = (index) => src.slice(0, index).split('\n').length;
  for (const t of src.matchAll(/\b(?:sql|db)`/g)) {
    const open = t.index + t[0].length - 1;
    let i = open + 1;
    let depth = 0;
    const spans = [];
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '{' && src[i - 1] === '$') {
        depth = 1;
        const start = i + 1;
        i++;
        while (i < src.length && depth > 0) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') { depth--; if (depth === 0) break; }
          else if (src[i] === '`') {
            // a nested template: skip it wholesale
            const inner = src.indexOf('`', i + 1);
            if (inner < 0) { i = src.length; break; }
            i = inner + 1;
            continue;
          }
          i++;
        }
        spans.push([start, i]);
        i++;
        continue;
      }
      if (c === '`') break;
      i++;
    }
    for (const [start, end] of spans) {
      const expr = src.slice(start, end);
      // Property names after a dot are not identifiers, and neither is
      // anything inside a string.
      let scrubbed = stripLiterals(expr).replace(/\.\s*([A-Za-z_$][\w$]*)/g, '.');
      // Object literal keys: { a: 1 }
      scrubbed = scrubbed.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1');
      for (const id of scrubbed.match(/[A-Za-z_$][\w$]*/g) || []) {
        if (declared.has(id) || GLOBALS.has(id)) continue;
        problems.push({ file, line: lineOf(start), id, expr: expr.trim().slice(0, 110) });
      }
    }
  }
}

  // A CTE name is SQL, not JavaScript. `${current.branch}` is a ReferenceError at
  // request time: the credit book collection endpoint answered 500 on every
  // attempt and had never once worked. Catch the shape, not the one instance.
// A CTE name is SQL, not JavaScript. `${current.branch}` is a ReferenceError at
// request time: the credit book collection endpoint answered 500 on every
// attempt and had never once worked. The precise rule is a name that exists in
// this file ONLY as a CTE -- `current` is never a JS variable here, so the
// interpolation can only be a mistake.
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const jsNames = new Set();
  for (const m of src.matchAll(/\b(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)/g)) jsNames.add(m[1]);
  for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) jsNames.add(m[1]);
  const cteNames = new Set();
  for (const m of src.matchAll(/\bWITH\s+([a-z_][a-z_0-9]*)\s+AS\s*\(/gi)) cteNames.add(m[1]);
  for (const m of src.matchAll(/,\s*([a-z_][a-z_0-9]*)\s+AS\s*\(/gi)) cteNames.add(m[1]);
  for (const name of cteNames) {
    if (jsNames.has(name)) continue;
    for (const m of src.matchAll(new RegExp('\\$\\{' + name + '\\.', 'g'))) {
      const line = src.slice(0, m.index).split('\n').length;
      problems.push({ file, line, id: 'CTE-NAME-AS-JS', expr: 'sql`... ${' + name + '. ...}` -- "' + name + '" is a CTE in SQL, never a JS variable' });
    }
  }
}

if (problems.length) {
  console.error(`\n${problems.length} undeclared identifier(s) inside sql interpolations — these throw ReferenceError at request time:\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}  ${p.id}`);
    console.error(`      ${p.expr}\n`);
  }
  process.exit(1);
}
console.log(`  PASS — no sql interpolation references a name the file does not declare (${files.join(', ')})`);

