// Backward-compatible entry point; Mock now uses the verified session flow.
process.argv.push("--mock");
await import("../qq-auth/index.mjs");
