// Static pages: each is prerendered as an empty shell and renders in the browser, since both read
// their settings from the query string, which a prerendered page can't know.
export const prerender = true;
export const ssr = false;
// setup/ is served as setup/index.html, which any static host finds.
export const trailingSlash = 'always';
