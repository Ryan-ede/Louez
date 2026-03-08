import type { RegisteredIntegration } from '@/lib/integrations/registry/types'

import { apiIntegrationAdapter } from './api/adapter'
import { apiIntegrationManifest } from './api/manifest'
import { tulipIntegrationAdapter } from './tulip/adapter'
import { tulipIntegrationManifest } from './tulip/manifest'

export const providerIntegrations: RegisteredIntegration[] = [
  {
    manifest: apiIntegrationManifest,
    adapter: apiIntegrationAdapter,
  },
  {
    manifest: tulipIntegrationManifest,
    adapter: tulipIntegrationAdapter,
  },
]
