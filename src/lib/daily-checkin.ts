import 'server-only';

import { listVendorDefinitions } from '@/lib/vendor-definitions';
import { listVendorSettings } from '@/lib/vendor-settings';

export type DailyCheckinEnabledVendor = {
  id: number;
  name: string;
  vendorType: string;
  displayName: string;
};

export function listDailyCheckinEnabledVendors(): DailyCheckinEnabledVendor[] {
  const definitions = listVendorDefinitions();
  const enabledTypeMap = new Map<string, string>();

  for (const definition of definitions) {
    if (definition.regionConfig.dailyCheckinEnabled !== true) {
      continue;
    }
    enabledTypeMap.set(definition.vendorType, definition.displayName);
  }

  if (enabledTypeMap.size === 0) {
    return [];
  }

  return listVendorSettings()
    .filter((vendor): vendor is typeof vendor & { vendorType: string } =>
      vendor.vendorType !== null && enabledTypeMap.has(vendor.vendorType))
    .map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      vendorType: vendor.vendorType,
      displayName: enabledTypeMap.get(vendor.vendorType) || vendor.vendorType,
    }));
}
