import { apiFetch } from './api';

export interface ProviderSummary {
  id: string;
  name: string;
  type: string;
}

let cachedProviders: ProviderSummary[] | null = null;

export async function getProviderName(providerId: string | null): Promise<string | null> {
  if (!providerId) return null;
  if (!cachedProviders) {
    try {
      const res = await apiFetch<{ items: ProviderSummary[] }>('/api/v1/providers', {
        method: 'GET',
        skipAuthRedirect: true,
      });
      cachedProviders = res.items;
    } catch {
      return null;
    }
  }
  const match = cachedProviders?.find((p) => p.id === providerId);
  return match ? match.name : null;
}

