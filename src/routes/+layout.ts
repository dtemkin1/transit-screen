// Static pages: each is prerendered as an empty shell and renders in the browser, since the board
// reads its settings from the query string, which a prerendered page can't know.
export const prerender = true;
export const ssr = false;
// A page at path/ is served as path/index.html, which any static host finds.
export const trailingSlash = 'always';
