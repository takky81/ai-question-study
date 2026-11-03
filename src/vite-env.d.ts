/// <reference types="vite/client" />

// クライアントへ公開してよい環境変数だけを宣言する（秘密情報は置かない）。
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
