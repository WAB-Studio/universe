// A stand-in for the real `server-only` package (see `next/dist/compiled/server-only`),
// resolvable only when `NODE_PATH` points at this directory — set by
// `check:policies` alone, never by `next dev`/`next build`. Its real job
// (throw when bundled into a Client Component) is a webpack-time concern;
// under plain Node there is no bundler to enforce it, so this is a no-op,
// the same shape Next's own "react-server" condition resolves to.
module.exports = {};
