import { db } from '@louez/db'
import { z } from 'zod'

import { requirePermission } from '../../procedures'
import { createApiKey, listApiKeys, revokeApiKey } from '../../services/api-keys'
import { toORPCError } from '../../utils/orpc-error'

const list = requirePermission('manage_settings').handler(
  async ({ context }) => {
    try {
      return await listApiKeys({
        db,
        storeId: context.store.id,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  },
)

const create = requirePermission('manage_settings')
  .input(
    z.object({
      name: z.string().min(1).max(100),
      scopes: z.array(z.string()).min(1),
      expiresAt: z.coerce.date().optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    try {
      return await createApiKey({
        db,
        storeId: context.store.id,
        userId: context.session.user!.id!,
        name: input.name,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

const revoke = requirePermission('manage_settings')
  .input(z.object({ keyId: z.string() }))
  .handler(async ({ context, input }) => {
    try {
      await revokeApiKey({
        db,
        storeId: context.store.id,
        keyId: input.keyId,
      })
      return { success: true as const }
    } catch (error) {
      throw toORPCError(error)
    }
  })

export const dashboardApiKeysRouter = {
  list,
  create,
  revoke,
}
