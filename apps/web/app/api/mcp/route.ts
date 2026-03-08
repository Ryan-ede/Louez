import { db, products, customers, reservations, stores } from '@louez/db'
import { validateApiKey } from '@louez/api/services'
import { and, desc, eq, sql } from 'drizzle-orm'
import { type NextRequest } from 'next/server'

// ============================================================================
// MCP Protocol Types (minimal inline to avoid SDK dependency at runtime)
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: string | number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function rpcResult(id: string | number | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(
  id: string | number | undefined,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

// ============================================================================
// Tool definitions
// ============================================================================

const TOOLS = [
  {
    name: 'list_products',
    description: 'List all products in the store catalog',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'draft', 'archived', 'all'],
          description: 'Filter by product status',
        },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
    },
  },
  {
    name: 'get_product',
    description: 'Get details of a specific product by ID',
    inputSchema: {
      type: 'object' as const,
      properties: {
        productId: { type: 'string', description: 'The product ID' },
      },
      required: ['productId'],
    },
  },
  {
    name: 'list_customers',
    description: 'List customers of the store',
    inputSchema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search by name or email' },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
    },
  },
  {
    name: 'get_customer',
    description: 'Get details of a specific customer by ID',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customerId: { type: 'string', description: 'The customer ID' },
      },
      required: ['customerId'],
    },
  },
  {
    name: 'list_reservations',
    description: 'List reservations for the store',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'confirmed', 'ongoing', 'completed', 'cancelled', 'rejected'],
          description: 'Filter by reservation status',
        },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
    },
  },
  {
    name: 'get_reservation',
    description: 'Get details of a specific reservation by ID',
    inputSchema: {
      type: 'object' as const,
      properties: {
        reservationId: { type: 'string', description: 'The reservation ID' },
      },
      required: ['reservationId'],
    },
  },
  {
    name: 'get_store_info',
    description: 'Get store information (name, description, contact)',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
]

// Scope required for each tool
const TOOL_SCOPES: Record<string, string> = {
  list_products: 'products:read',
  get_product: 'products:read',
  list_customers: 'customers:read',
  get_customer: 'customers:read',
  list_reservations: 'reservations:read',
  get_reservation: 'reservations:read',
  get_store_info: 'products:read', // Any scope grants store info access
}

// ============================================================================
// Tool execution
// ============================================================================

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  storeId: string,
): Promise<unknown> {
  switch (name) {
    case 'list_products': {
      const status = (args.status as string) ?? 'active'
      const limit = Math.min(Number(args.limit ?? 50), 100)
      return db
        .select()
        .from(products)
        .where(
          and(
            eq(products.storeId, storeId),
            status !== 'all'
              ? eq(products.status, status as 'active' | 'draft' | 'archived')
              : undefined,
          ),
        )
        .orderBy(products.displayOrder, products.name)
        .limit(limit)
    }

    case 'get_product': {
      const product = await db.query.products.findFirst({
        where: and(
          eq(products.storeId, storeId),
          eq(products.id, args.productId as string),
        ),
      })
      if (!product) throw new Error('Product not found')
      return product
    }

    case 'list_customers': {
      const search = args.search as string | undefined
      const limit = Math.min(Number(args.limit ?? 50), 100)
      const conditions = [eq(customers.storeId, storeId)]
      if (search) {
        const searchLower = `%${search.toLowerCase()}%`
        conditions.push(
          sql`(
            LOWER(${customers.firstName}) LIKE ${searchLower} OR
            LOWER(${customers.lastName}) LIKE ${searchLower} OR
            LOWER(${customers.email}) LIKE ${searchLower}
          )`,
        )
      }
      return db
        .select()
        .from(customers)
        .where(and(...conditions))
        .orderBy(desc(customers.createdAt))
        .limit(limit)
    }

    case 'get_customer': {
      const customer = await db.query.customers.findFirst({
        where: and(
          eq(customers.storeId, storeId),
          eq(customers.id, args.customerId as string),
        ),
      })
      if (!customer) throw new Error('Customer not found')
      return customer
    }

    case 'list_reservations': {
      const status = args.status as string | undefined
      const limit = Math.min(Number(args.limit ?? 50), 100)
      const conditions = [eq(reservations.storeId, storeId)]
      if (status) {
        conditions.push(
          eq(
            reservations.status,
            status as 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected',
          ),
        )
      }
      return db
        .select()
        .from(reservations)
        .where(and(...conditions))
        .orderBy(desc(reservations.createdAt))
        .limit(limit)
    }

    case 'get_reservation': {
      const reservation = await db.query.reservations.findFirst({
        where: and(
          eq(reservations.storeId, storeId),
          eq(reservations.id, args.reservationId as string),
        ),
      })
      if (!reservation) throw new Error('Reservation not found')
      return reservation
    }

    case 'get_store_info': {
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, storeId),
        columns: {
          id: true,
          name: true,
          slug: true,
          description: true,
          email: true,
          phone: true,
          address: true,
          logoUrl: true,
          createdAt: true,
        },
      })
      if (!store) throw new Error('Store not found')
      return store
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ============================================================================
// MCP JSON-RPC handler
// ============================================================================

async function handleMcpRequest(
  rpc: JsonRpcRequest,
  storeId: string,
  scopes: string[],
): Promise<JsonRpcResponse> {
  switch (rpc.method) {
    case 'initialize':
      return rpcResult(rpc.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'louez',
          version: '1.0.0',
        },
      })

    case 'tools/list':
      // Only return tools the API key has scope for
      return rpcResult(rpc.id, {
        tools: TOOLS.filter((tool) => {
          const requiredScope = TOOL_SCOPES[tool.name]
          return !requiredScope || scopes.includes(requiredScope)
        }),
      })

    case 'tools/call': {
      const toolName = rpc.params?.name as string
      const toolArgs = (rpc.params?.arguments ?? {}) as Record<string, unknown>

      if (!toolName) {
        return rpcError(rpc.id, -32602, 'Missing tool name')
      }

      // Check scope
      const requiredScope = TOOL_SCOPES[toolName]
      if (requiredScope && !scopes.includes(requiredScope)) {
        return rpcError(rpc.id, -32600, `Missing scope: ${requiredScope}`)
      }

      try {
        const result = await executeTool(toolName, toolArgs, storeId)
        return rpcResult(rpc.id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        })
      } catch (err) {
        return rpcResult(rpc.id, {
          content: [
            {
              type: 'text',
              text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        })
      }
    }

    case 'notifications/initialized':
    case 'ping':
      return rpcResult(rpc.id, {})

    default:
      return rpcError(rpc.id, -32601, `Method not found: ${rpc.method}`)
  }
}

// ============================================================================
// HTTP Streamable transport (MCP 2025-03-26 spec)
// ============================================================================

async function authenticate(request: NextRequest) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  return validateApiKey({ db, rawKey: authorization.slice(7) })
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth) {
    return new Response(JSON.stringify(rpcError(undefined, -32000, 'Invalid or missing API key')), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await request.json()

  // Handle single request
  if (!Array.isArray(body)) {
    const result = await handleMcpRequest(body as JsonRpcRequest, auth.storeId, auth.scopes)
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Handle batch requests
  const results = await Promise.all(
    body.map((rpc: JsonRpcRequest) =>
      handleMcpRequest(rpc, auth.storeId, auth.scopes),
    ),
  )
  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * GET endpoint returns server capabilities for discovery.
 */
export async function GET() {
  return new Response(
    JSON.stringify({
      name: 'louez',
      version: '1.0.0',
      description: 'Louez rental management MCP server',
      transport: 'streamable-http',
      authentication: 'bearer',
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
}
