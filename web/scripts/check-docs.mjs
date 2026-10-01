import assert from "node:assert/strict";

const origin = process.argv[2] ?? "http://127.0.0.1:5173";

for (const path of ["/docs", "/docs/", "/docs/web/?q=ranking", "/docs/privacy", "/docs/privacy/"]) {
  const response = await fetch(new URL(path, origin));
  assert.equal(response.status, 200, path);
  const html = await response.text();
  assert.match(html, /<title>[^<]*commonly-cited<\/title>/, path);
  assert.ok(!html.includes('<div id="root">'), path + " returned the app instead of docs");
  const stylesheet = html.match(/href="([^"]*assets\/stylesheets\/main[^"]+\.css)"/);
  assert.ok(stylesheet, path + " has no documentation stylesheet");
  const css = await fetch(new URL(stylesheet[1], response.url));
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
}

console.log("Documentation pages and styles load correctly.");
