import type { IntegrationManifest } from '@/lib/integrations/registry/types'

export const apiIntegrationManifest: IntegrationManifest = {
  id: 'api',
  category: 'developer',
  nameKey: 'dashboard.settings.integrationsHub.providers.api.name',
  descriptionKey:
    'dashboard.settings.integrationsHub.providers.api.description',
  logoPath: '/integrations/api/logo.svg',
  galleryPaths: [],
  providerName: 'Louez',
  pricingLabel: 'Included in plan',
  resourceLinks: [
    {
      labelKey:
        'dashboard.settings.integrationsHub.providers.api.resources.docs',
      url: 'https://github.com/synapsr/louez',
    },
  ],
  featureKeys: [
    'dashboard.settings.integrationsHub.providers.api.features.rest',
    'dashboard.settings.integrationsHub.providers.api.features.mcp',
    'dashboard.settings.integrationsHub.providers.api.features.keys',
  ],
  aboutKey: 'dashboard.settings.integrationsHub.providers.api.about',
  websiteUrl: 'https://github.com/synapsr/louez',
  status: 'beta',
}
