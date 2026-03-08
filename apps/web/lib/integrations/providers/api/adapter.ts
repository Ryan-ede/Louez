import { setIntegrationEnabledState, isIntegrationEnabled } from '@/lib/integrations/registry/state'
import type { IntegrationAdapter } from '@/lib/integrations/registry/types'

import { ApiConfigurationPanel } from './api-configuration-panel'

export const apiIntegrationAdapter: IntegrationAdapter = {
  getStatus: (settings) => ({
    enabled: isIntegrationEnabled(settings, 'api'),
    connected: isIntegrationEnabled(settings, 'api'),
    configured: false,
    connectionIssue: null,
  }),
  setEnabled: (settings, enabled) =>
    setIntegrationEnabledState(settings, 'api', enabled),
  getConfigurationPanel: () => ApiConfigurationPanel,
}
