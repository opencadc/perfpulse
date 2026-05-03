const result = await Bun.build({
  entrypoints: ["src/perfpulse.ts"],
  external: ["k6", "k6/*"],
  format: "esm",
  minify: false,
  outdir: "dist",
  sourcemap: "none",
  target: "browser",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("Built dist/perfpulse.js");

export {};
