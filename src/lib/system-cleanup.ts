import 'server-only';

import { listEndpoints } from '@/lib/db';
import { clearCachedResults } from '@/lib/quota/cache';
import {
  deleteEndpointSettings,
  deleteOrphanedVendors,
  listEndpointSettings,
} from '@/lib/vendor-settings';

export type SystemCleanupResult = {
  deletedEndpoints: number;
  deletedVendors: number;
};

export async function runSystemCleanupFromHub(): Promise<SystemCleanupResult> {
  const endpoints = await listEndpoints();
  const activeEndpointIds = new Set(endpoints.map((endpoint) => endpoint.id));
  const localSettings = listEndpointSettings();
  const staleEndpointIds = Array.from(
    new Set(
      localSettings
        .map((setting) => setting.endpointId)
        .filter((endpointId) => !activeEndpointIds.has(endpointId)),
    ),
  );

  const deletedEndpoints = deleteEndpointSettings(staleEndpointIds);
  await clearCachedResults(staleEndpointIds);
  const deletedVendors = deleteOrphanedVendors();

  return {
    deletedEndpoints,
    deletedVendors,
  };
}
