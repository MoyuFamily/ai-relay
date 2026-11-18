// ============================================================
// AI Relay — Next.js Server Instrumentation Hook
// ============================================================
// Automatically starts the self-hosted background scheduler on
// standalone Node.js / Docker / VPS servers while staying inert
// on Vercel, Cloudflare Pages/Workers, and static build phases.

export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    !process.env.VERCEL &&
    !process.env.CF_PAGES &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { startSelfHostedScheduler } = await import('./lib/runtime/self-hosted-scheduler');
    startSelfHostedScheduler();
  }
}
