// Settings come from src/env.ts ($app/env/public), so an `import.meta.env.X` that slips in is a type error.
interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}
