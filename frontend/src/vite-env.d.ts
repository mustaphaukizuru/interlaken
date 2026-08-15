/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_WHATSAPP_NUMBER?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  readonly VITE_GIT_SHA?: string;
  // Analytics (consent-gated; configure at most one provider)
  readonly VITE_GA4_MEASUREMENT_ID?: string;
  readonly VITE_PLAUSIBLE_DOMAIN?: string;
  readonly VITE_PLAUSIBLE_SRC?: string;
  // Web push (opt-in)
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
