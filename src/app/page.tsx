import { PROVIDERS } from '@/lib/providers';
import Homepage, { type HomepageProvider } from './Homepage';

export const dynamic = 'force-static';

const HOMEPAGE_HIDDEN_VARIANTS = new Set(['xiaomi_sgp_coding', 'xiaomi_coding']);

export default function Home() {
  const providers: HomepageProvider[] = Object.entries(PROVIDERS)
    .filter(([id]) => !HOMEPAGE_HIDDEN_VARIANTS.has(id))
    .map(([id, config]) => ({
      id,
      name: config.displayName,
      prefixes: config.modelPrefixes,
      models: config.models || [],
    }));

  return <Homepage providers={providers} />;
}
