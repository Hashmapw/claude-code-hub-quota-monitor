export type QuotaStatus =
  | 'ok'
  | 'unauthorized'
  | 'network_error'
  | 'unsupported'
  | 'parse_error'
  | 'not_checked';

export type CredentialIssue = 'cookie_expired' | null;

export type AuthMethod = 'bearer' | 'url_key' | 'cookie';

export type VendorType = string;
export type EndpointBillingMode = 'usage' | 'duration';

export type QuotaResult = {
  status: QuotaStatus;
  strategy: string;
  totalUsd: number | null;
  usedUsd: number | null;
  remainingUsd: number | null;
  staleLock?: {
    reason: 'refresh_error';
    lockedAt: string;
    previousCheckedAt: string | null;
    totalUsd?: number | null;
    usedUsd?: number | null;
    remainingUsd?: number | null;
  } | null;
  totalSource?: string | null;
  regionMetrics?: {
    vendorUsedUsd?: number | null;
    vendorRemainingUsd?: number | null;
    endpointUsedUsd?: number | null;
    endpointRemainingUsd?: number | null;
    endpointTotalUsd?: number | null;
  };
  regionSources?: {
    vendorUsed?: string | null;
    vendorRemaining?: string | null;
    endpointUsed?: string | null;
    endpointRemaining?: string | null;
    endpointTotal?: string | null;
    tokenUsed?: string | null;
    tokenAvailable?: string | null;
    lastCreditReset?: string | null;
  };
  regionFieldPaths?: {
    vendorUsed?: string | null;
    vendorRemaining?: string | null;
    endpointUsed?: string | null;
    endpointRemaining?: string | null;
    endpointTotal?: string | null;
    tokenUsed?: string | null;
    tokenAvailable?: string | null;
    lastCreditReset?: string | null;
    aggregationMode?: string | null;
    endpointTotalMode?: string | null;
  };
  usedSource?: string | null;
  remainingSource?: string | null;
  rawSnippet?: string;
  message?: string;
  checkedAt: string | null;
  latencyMs: number | null;
  credentialIssue?: CredentialIssue;
  tokenUsed?: number | null;
  tokenAvailable?: number | null;
  lastCreditReset?: string | null;
};

export type QuotaDebugAttempt = {
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  status: number;
  latencyMs: number;
  contentType: string | null;
  requestHeaders: Record<string, string>;
  requestBodyPreview?: string;
  bodyPreview?: string;
  error?: string;
};

export type QuotaDebugProbePurpose =
  | 'amount'
  | 'token_usage'
  | 'reset_date'
  | 'identity'
  | 'compat_deprecated'
  | 'refresh'
  | 'daily_checkin'
  | 'other';

export type QuotaDebugProbe = {
  strategy: string;
  path: string;
  status: number;
  latencyMs: number;
  contentType: string | null;
  preview: string;
  attempts: QuotaDebugAttempt[];
  purpose?: QuotaDebugProbePurpose;
  note?: string;
};

export type QuotaDebugSnapshot = {
  endpointId: number;
  generatedAt: string;
  resultStatus: QuotaStatus;
  resultStrategy: string;
  resultMessage?: string | null;
  resultTotalUsd?: number | null;
  resultUsedUsd?: number | null;
  resultRemainingUsd?: number | null;
  resultStaleLock?: {
    reason: 'refresh_error';
    lockedAt: string;
    previousCheckedAt: string | null;
    totalUsd?: number | null;
    usedUsd?: number | null;
    remainingUsd?: number | null;
  } | null;
  resultTokenUsed?: number | null;
  resultTokenAvailable?: number | null;
  resultLastCreditReset?: string | null;
  resultTotalSource?: string | null;
  resultUsedSource?: string | null;
  resultRemainingSource?: string | null;
  resultRegionMetrics?: {
    vendorUsedUsd?: number | null;
    vendorRemainingUsd?: number | null;
    endpointUsedUsd?: number | null;
    endpointRemainingUsd?: number | null;
    endpointTotalUsd?: number | null;
  } | null;
  resultRegionSources?: {
    vendorUsed?: string | null;
    vendorRemaining?: string | null;
    endpointUsed?: string | null;
    endpointRemaining?: string | null;
    endpointTotal?: string | null;
    tokenUsed?: string | null;
    tokenAvailable?: string | null;
    lastCreditReset?: string | null;
    dailyCheckinDate?: string | null;
    dailyCheckinAwarded?: string | null;
  } | null;
  resultRegionFieldPaths?: {
    vendorUsed?: string | null;
    vendorRemaining?: string | null;
    endpointUsed?: string | null;
    endpointRemaining?: string | null;
    endpointTotal?: string | null;
    tokenUsed?: string | null;
    tokenAvailable?: string | null;
    lastCreditReset?: string | null;
    dailyCheckinDate?: string | null;
    dailyCheckinAwarded?: string | null;
    aggregationMode?: string | null;
    endpointTotalMode?: string | null;
  } | null;
  resultDailyCheckinDate?: string | null;
  resultDailyCheckinAwarded?: number | null;
  resultDailyCheckinSource?: string | null;
  resultDailyCheckinStatus?: QuotaStatus | null;
  resultDailyCheckinMessage?: string | null;
  probes: QuotaDebugProbe[];
};

export type QuotaQueryOutput = {
  result: QuotaResult;
  debugProbes: QuotaDebugProbe[];
  detectedUserId?: string | null;
  refreshedAccessToken?: string | null;
  refreshedCookieValue?: string | null;
  refreshedEnvVars?: Record<string, string>;
};

export type QuotaRecord = {
  endpointId: number;
  endpointName: string;
  endpointUrl: string;
  endpointConsoleUrl: string | null;
  endpointApiKey: string;
  endpointType: string | null;
  endpointVendorId: number | null;
  isEnabled: boolean;
  vendorId: number | null;
  vendorName: string | null;
  vendorType: VendorType;
  billingMode: EndpointBillingMode;
  useVendorGroup: boolean;
  useVendorUsed: boolean;
  useVendorRemaining: boolean;
  useVendorAmount: boolean;
  useVendorBalance: boolean;
  endpointEnvVars?: Record<string, string>;
  isHidden: boolean;
  vendorBalanceUsd: number | null;
  vendorTotalUsd: number | null;
  vendorBalanceCheckedAt: string | null;
  vendorBalanceStrategy: string | null;
  result: QuotaResult;
};

export type EndpointIdentity = {
  id: number;
  name: string;
  baseUrl: string;
  apiKey: string;
  isEnabled: boolean;
  vendorType: VendorType;
  vendorTotalUsd: number | null;
  useVendorAmount: boolean;
  vendorBalanceUsd: number | null;
  userId?: string | null;
  authMethod: AuthMethod;
  urlKeyName?: string | null;
  cookieQueryEnabled: boolean;
  cookieHeaderText?: string | null;
  cookieValue?: string | null;
  vendorCookieForAcw?: string | null;
  templateVariables?: Record<string, string>;
};
