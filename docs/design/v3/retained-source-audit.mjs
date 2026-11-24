// Read-only route/source inventory. Metrics are inspection hints, not UI sign-off.
// Run from any directory: node docs/design/v3/retained-source-audit.mjs [--check]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(path.join(root, 'frontend/package.json'));
const ts = require('typescript');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const parse = relative => ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true, relative.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const app = parse('frontend/src/App.tsx'), navigation = parse('frontend/src/components/layout/navigation.ts');
const tag = node => ts.isJsxElement(node) ? node.openingElement.tagName.getText(app) : ts.isJsxSelfClosingElement(node) ? node.tagName.getText(app) : '';
function attributes(node) {
  const attrs = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;
  return Object.fromEntries(attrs.properties.filter(ts.isJsxAttribute).map(attr => [attr.name.text, !attr.initializer ? true : ts.isStringLiteral(attr.initializer) ? attr.initializer.text : attr.initializer.expression]));
}
function literal(node) {
  if (ts.isAsExpression(node)) return literal(node.expression);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(prop => [prop.name.text, literal(prop.initializer)]));
  throw Error(`Unsupported navigation expression: ${node.getText(navigation).slice(0, 80)}`);
}
const nav = {};
const shellNavigation = parse('frontend/src/components/layout/ShellNavigation.tsx');
let shellExtras = [];
for (const statement of shellNavigation.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (declaration.name.getText(shellNavigation) === 'extraItems') shellExtras = literal(declaration.initializer);
for (const statement of navigation.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (['PRIMARY_NAV_ITEMS', 'HIDDEN_COMPATIBILITY_ROUTES'].includes(declaration.name.getText(navigation))) nav[declaration.name.getText(navigation)] = literal(declaration.initializer);
const entryFiles = new Map();
for (const statement of app.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
  let module;
  function imports(node) { if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) module = node.arguments[0].text; ts.forEachChild(node, imports); }
  if (declaration.initializer) imports(declaration.initializer);
  if (module) { const base = path.resolve(root, 'frontend/src', module); const file = ['.tsx', '.ts', '/index.tsx', '/index.ts'].map(suffix => base + suffix).find(fs.existsSync); if (!file) throw Error(`Unresolved import: ${module}`); entryFiles.set(declaration.name.getText(app), path.relative(root, file)); }
}
function renderer(node) {
  if (ts.isJsxExpression(node)) return renderer(node.expression);
  if (tag(node) === 'ProtectedRoute') return renderer(node.children.find(child => tag(child)));
  if (!tag(node)) throw Error('Unsupported route renderer');
  return { component: tag(node), attrs: attributes(node) };
}
const routes = [], redirects = [], shells = [];
function walk(node, parent = '') {
  if (tag(node) === 'Route') {
    const attrs = attributes(node), segment = attrs.path || '';
    if (typeof segment !== 'string') throw Error('Dynamic route path needs explicit inventory support');
    const routePath = (segment.startsWith('/') ? segment : `${parent}/${segment}`).replace(/\/$/, '') || '/';
    const rendered = renderer(attrs.element);
    const children = ts.isJsxElement(node) ? node.children.filter(child => tag(child) === 'Route') : [];
    if (['Navigate', 'CompatibilityRedirect'].includes(rendered.component)) redirects.push({ path: routePath, component: rendered.component, to: rendered.attrs.to });
    else if (children.length) shells.push({ path: routePath, component: rendered.component });
    else {
      const file = entryFiles.get(rendered.component); if (!file) throw Error(`No source for ${rendered.component}`);
      const source = read(file), lines = source.split('\n');
      const hints = lines.flatMap((text, index) => /text-\[(?:[5-9]|1[01])px\]|\btruncate\b|line-clamp-|(?:min-)?w-\[(?:\d+)px\]|grid-cols-(?:[5-9]|1[02])\b/.test(text) ? [{ line: index + 1, text: text.trim().slice(0, 180) }] : []);
      const primary = nav.PRIMARY_NAV_ITEMS.find(item => item.path === routePath);
      const extra = shellExtras.find(item => item.path === routePath);
      const hidden = nav.HIDDEN_COMPATIBILITY_ROUTES.filter(item => routePath === item.path || routePath.startsWith(item.path + '/')).sort((a, b) => b.path.length - a.path.length)[0];
      routes.push({ path: routePath, component: rendered.component, entry_file: file, primary_navigation: primary ? { label: primary.label, state: primary.state } : null, shell_menu_extra: extra ? { label: extra.label, state: extra.state } : null, hidden_compatibility_reason: hidden?.reason || null, source_hints: hints });
    }
    children.forEach(child => walk(child, routePath));
    return;
  }
  ts.forEachChild(node, child => walk(child, parent));
}
walk(app);
const output = { method: 'App.tsx leaf render routes, shells and redirects; navigation annotations from navigation.ts and ShellNavigation.tsx extraItems (the two JSX derivatives links are documented separately). Direct entry-file source hints only: not runtime defects, descendant coverage, populated review or accessibility sign-off.', counts: { render_routes: routes.length, unique_entry_files: new Set(routes.map(row => row.entry_file)).size, shells: shells.length, redirects: redirects.length, primary_navigation: routes.filter(row => row.primary_navigation).length, shell_menu_extra: routes.filter(row => row.shell_menu_extra).length, hidden_compatibility: routes.filter(row => row.hidden_compatibility_reason).length }, routes, shells, redirects };
const files = new Map([
  ['docs/design/v3/evidence/retained-source-audit.json', JSON.stringify(output, null, 2) + '\n'],
  ['docs/design/v3/RETAINED_ROUTE_LEDGER.md', '# Retained frontend route ledger\n\nGenerated by `retained-source-audit.mjs`; do not edit by hand. This inventories routes, not completed UI reviews. See [audit and delivery order](RETAINED_PAGE_AUDIT.md).\n\nDirect entry-file hints identify small text, truncation, fixed widths or dense grids for inspection. They can be deliberate numerical/decorative styles, may be overridden at runtime, and do not cover descendant components. Zero hints is not a pass. “Other direct” does not mean a route is supported, hidden or newly advertised.\n\n| Render route | Entry source | Declared navigation | Entry-file hints |\n|---|---|---|---|\n' + routes.map(row => `| \`${row.path}\` | [${row.component}](../../../${row.entry_file}) | ${row.primary_navigation ? row.primary_navigation.state : row.shell_menu_extra ? 'Shell menu extra' : row.hidden_compatibility_reason ? 'Hidden compatibility' : 'Other direct'} | ${row.source_hints.length} |`).join('\n') + '\n\nShells: ' + shells.map(row => `\`${row.path}\``).join(', ') + '. Redirects and source-line hints are listed in [the JSON inventory](evidence/retained-source-audit.json).\n'],
]);
for (const [relative, serialized] of files) {
  const target = path.join(root, relative);
  if (process.argv.includes('--check')) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== serialized) throw Error('Retained-source audit is stale; regenerate it.'); }
  else fs.writeFileSync(target, serialized);
}
console.log(JSON.stringify(output.counts));
