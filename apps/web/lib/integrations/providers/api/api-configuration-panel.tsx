'use client'

import type React from 'react'
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Key,
  Plus,
  Terminal,
  Trash2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toastManager } from '@louez/ui'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Separator,
} from '@louez/ui'

import { orpc } from '@/lib/orpc/react'

type ApiKeyItem = {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  revokedAt: Date | null
}

const AVAILABLE_SCOPES = [
  { id: 'products:read', label: 'Products (read)' },
  { id: 'customers:read', label: 'Customers (read)' },
  { id: 'reservations:read', label: 'Reservations (read)' },
  { id: 'availability:read', label: 'Availability (read)' },
] as const

export function ApiConfigurationPanel() {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>(
    AVAILABLE_SCOPES.map((s) => s.id),
  )
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)
  const [showMcpConfig, setShowMcpConfig] = useState(false)
  const [copiedMcp, setCopiedMcp] = useState(false)

  const resolveMessage = (key: string, fallback: string): string => {
    try {
      const value = t(key as never)
      if (!value || value === key) return fallback
      return value
    } catch {
      return fallback
    }
  }

  const keysQuery = useQuery(
    orpc.dashboard.apiKeys.list.queryOptions({ input: {} }),
  )

  const createMutation = useMutation({
    ...orpc.dashboard.apiKeys.create.mutationOptions(),
    onSuccess: (data: { id: string; key: string; prefix: string }) => {
      setCreatedKey(data.key)
      setNewKeyName('')
      setSelectedScopes(AVAILABLE_SCOPES.map((s) => s.id))
      queryClient.invalidateQueries({
        queryKey: orpc.dashboard.apiKeys.list.queryOptions({ input: {} }).queryKey,
      })
    },
    onError: (error: Error) => {
      toastManager.error(error.message)
    },
  })

  const revokeMutation = useMutation({
    ...orpc.dashboard.apiKeys.revoke.mutationOptions(),
    onSuccess: () => {
      toastManager.success(
        resolveMessage(
          'dashboard.settings.integrationsHub.providers.api.keyRevoked',
          'API key revoked',
        ),
      )
      queryClient.invalidateQueries({
        queryKey: orpc.dashboard.apiKeys.list.queryOptions({ input: {} }).queryKey,
      })
    },
    onError: (error: Error) => {
      toastManager.error(error.message)
    },
  })

  const handleCopy = async (text: string, setter: (v: boolean) => void) => {
    await navigator.clipboard.writeText(text)
    setter(true)
    setTimeout(() => setter(false), 2000)
  }

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((s) => s !== scope)
        : [...prev, scope],
    )
  }

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        louez: {
          url: `${typeof window !== 'undefined' ? window.location.origin : ''}/api/mcp`,
          headers: {
            Authorization: 'Bearer <YOUR_API_KEY>',
          },
        },
      },
    },
    null,
    2,
  )

  const keys = (keysQuery.data ?? []) as ApiKeyItem[]

  return (
    <div className="space-y-6">
      {/* API Keys section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">
              {resolveMessage(
                'dashboard.settings.integrationsHub.providers.api.keysTitle',
                'API Keys',
              )}
            </h3>
            <p className="text-muted-foreground text-sm">
              {resolveMessage(
                'dashboard.settings.integrationsHub.providers.api.keysDescription',
                'Manage API keys for REST API and MCP access.',
              )}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {resolveMessage(
              'dashboard.settings.integrationsHub.providers.api.createKey',
              'Create key',
            )}
          </Button>
        </div>

        {keys.length === 0 && !keysQuery.isLoading ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Key className="text-muted-foreground mb-3 h-8 w-8" />
              <p className="text-muted-foreground text-sm">
                {resolveMessage(
                  'dashboard.settings.integrationsHub.providers.api.noKeys',
                  'No API keys yet. Create one to get started.',
                )}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {keys.map((apiKey) => (
              <Card key={apiKey.id}>
                <CardContent className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <Key className="text-muted-foreground h-4 w-4" />
                    <div>
                      <p className="text-sm font-medium">{apiKey.name}</p>
                      <p className="text-muted-foreground font-mono text-xs">
                        {apiKey.keyPrefix}...
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-wrap gap-1">
                      {apiKey.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary" className="text-xs">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                    {apiKey.lastUsedAt && (
                      <span className="text-muted-foreground text-xs">
                        {resolveMessage(
                          'dashboard.settings.integrationsHub.providers.api.lastUsed',
                          'Last used',
                        )}{' '}
                        {new Date(apiKey.lastUsedAt).toLocaleDateString()}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive h-8 w-8"
                      onClick={() => revokeMutation.mutate({ keyId: apiKey.id })}
                      disabled={revokeMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* Endpoints section */}
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">
            {resolveMessage(
              'dashboard.settings.integrationsHub.providers.api.endpointsTitle',
              'Endpoints',
            )}
          </h3>
          <p className="text-muted-foreground text-sm">
            {resolveMessage(
              'dashboard.settings.integrationsHub.providers.api.endpointsDescription',
              'Use these endpoints to access your store data.',
            )}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                <CardTitle className="text-sm">REST API</CardTitle>
              </div>
              <CardDescription className="text-xs">
                {resolveMessage(
                  'dashboard.settings.integrationsHub.providers.api.restDescription',
                  'Standard HTTP endpoints for your data.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <code className="bg-muted rounded px-2 py-1 text-xs">
                {typeof window !== 'undefined' ? window.location.origin : ''}/api/v1
              </code>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                <CardTitle className="text-sm">MCP Server</CardTitle>
              </div>
              <CardDescription className="text-xs">
                {resolveMessage(
                  'dashboard.settings.integrationsHub.providers.api.mcpDescription',
                  'Connect AI assistants to your store.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMcpConfig(!showMcpConfig)}
              >
                {showMcpConfig ? (
                  <EyeOff className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <Eye className="mr-1.5 h-3.5 w-3.5" />
                )}
                {resolveMessage(
                  'dashboard.settings.integrationsHub.providers.api.showConfig',
                  'Show config',
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {showMcpConfig && (
          <Card>
            <CardContent className="relative pt-4">
              <pre className="bg-muted overflow-x-auto rounded-lg p-4 text-xs">
                {mcpConfig}
              </pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-6 right-6 h-7 w-7"
                onClick={() => handleCopy(mcpConfig, setCopiedMcp)}
              >
                {copiedMcp ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create key dialog */}
      <Dialog
        open={showCreate}
        onOpenChange={(open: boolean) => {
          setShowCreate(open)
          if (!open) {
            setCreatedKey(null)
            setCopiedKey(false)
          }
        }}
      >
        <DialogContent>
          {createdKey ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {resolveMessage(
                    'dashboard.settings.integrationsHub.providers.api.keyCreated',
                    'API key created',
                  )}
                </DialogTitle>
                <DialogDescription>
                  {resolveMessage(
                    'dashboard.settings.integrationsHub.providers.api.keyCreatedDescription',
                    'Copy this key now. You won\'t be able to see it again.',
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="bg-muted flex items-center gap-2 rounded-lg p-3">
                  <code className="flex-1 break-all text-sm">{createdKey}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => handleCopy(createdKey, setCopiedKey)}
                  >
                    {copiedKey ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setShowCreate(false)
                    setCreatedKey(null)
                  }}
                >
                  {resolveMessage(
                    'dashboard.settings.integrationsHub.providers.api.done',
                    'Done',
                  )}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {resolveMessage(
                    'dashboard.settings.integrationsHub.providers.api.createKeyTitle',
                    'Create API key',
                  )}
                </DialogTitle>
                <DialogDescription>
                  {resolveMessage(
                    'dashboard.settings.integrationsHub.providers.api.createKeyDescription',
                    'Choose a name and select the permissions for this key.',
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>
                    {resolveMessage(
                      'dashboard.settings.integrationsHub.providers.api.keyName',
                      'Key name',
                    )}
                  </Label>
                  <Input
                    placeholder={resolveMessage(
                      'dashboard.settings.integrationsHub.providers.api.keyNamePlaceholder',
                      'e.g. Production, My App...',
                    )}
                    value={newKeyName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewKeyName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    {resolveMessage(
                      'dashboard.settings.integrationsHub.providers.api.scopes',
                      'Permissions',
                    )}
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    {AVAILABLE_SCOPES.map((scope) => (
                      <button
                        key={scope.id}
                        type="button"
                        onClick={() => toggleScope(scope.id)}
                        className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                          selectedScopes.includes(scope.id)
                            ? 'border-primary bg-primary/5 text-foreground'
                            : 'border-border text-muted-foreground hover:border-primary/40'
                        }`}
                      >
                        {scope.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowCreate(false)}
                >
                  {resolveMessage(
                    'dashboard.settings.integrationsHub.providers.api.cancel',
                    'Cancel',
                  )}
                </Button>
                <Button
                  onClick={() =>
                    createMutation.mutate({
                      name: newKeyName,
                      scopes: selectedScopes,
                    })
                  }
                  disabled={
                    !newKeyName.trim() ||
                    selectedScopes.length === 0 ||
                    createMutation.isPending
                  }
                >
                  {resolveMessage(
                    'dashboard.settings.integrationsHub.providers.api.create',
                    'Create',
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
