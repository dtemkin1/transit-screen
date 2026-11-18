interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_WORKER_URL?: string;
  readonly VITE_ADOBE_FONTS_KIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
