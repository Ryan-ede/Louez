import { db, products, customers, reservations, stores } from '@louez/db'
import { validateApiKey } from '@louez/api/services'
import { and, desc, eq, sql } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'

type RouteHandler = (
  storeId: string,
  scopes: string[],
  request: NextRequest,
  pathSegments: string[],
) => Promise<NextResponse>

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function error(message: string, status: number) {
  return json({ error: message }, status)
}

/**
 * Authenticate the request using Bearer token (API key).
 */
async function authenticate(request: NextRequest) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  const rawKey = authorization.slice(7)
  return validateApiKey({ db, rawKey })
}

// ============================================================================
// Route handlers
// ============================================================================

async function handleProducts(
  storeId: string,
  _scopes: string[],
  request: NextRequest,
  segments: string[],
) {
  const productId = segments[0]

  if (productId) {
    const product = await db.query.products.findFirst({
      where: and(eq(products.storeId, storeId), eq(products.id, productId)),
    })
    if (!product) return error('Product not found', 404)
    return json({ product })
  }

  const url = new URL(request.url)
  const status = url.searchParams.get('status') ?? 'active'
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 100)
  const offset = Number(url.searchParams.get('offset') ?? 0)

  const rows = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.storeId, storeId),
        status !== 'all' ? eq(products.status, status as 'active' | 'draft' | 'archived') : undefined,
      ),
    )
    .orderBy(products.displayOrder, products.name)
    .limit(limit)
    .offset(offset)

  return json({ products: rows })
}

async function handleCustomers(
  storeId: string,
  _scopes: string[],
  request: NextRequest,
  segments: string[],
) {
  const customerId = segments[0]

  if (customerId) {
    const customer = await db.query.customers.findFirst({
      where: and(eq(customers.storeId, storeId), eq(customers.id, customerId)),
    })
    if (!customer) return error('Customer not found', 404)
    return json({ customer })
  }

  const url = new URL(request.url)
  const search = url.searchParams.get('search')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 100)
  const offset = Number(url.searchParams.get('offset') ?? 0)

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

  const rows = await db
    .select()
    .from(customers)
    .where(and(...conditions))
    .orderBy(desc(customers.createdAt))
    .limit(limit)
    .offset(offset)

  return json({ customers: rows })
}

async function handleReservations(
  storeId: string,
  _scopes: string[],
  request: NextRequest,
  segments: string[],
) {
  const reservationId = segments[0]

  if (reservationId) {
    const reservation = await db.query.reservations.findFirst({
      where: and(
        eq(reservations.storeId, storeId),
        eq(reservations.id, reservationId),
      ),
    })
    if (!reservation) return error('Reservation not found', 404)
    return json({ reservation })
  }

  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 100)
  const offset = Number(url.searchParams.get('offset') ?? 0)

  const conditions = [eq(reservations.storeId, storeId)]
  if (status) {
    conditions.push(
      eq(
        reservations.status,
        status as 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected',
      ),
    )
  }

  const rows = await db
    .select()
    .from(reservations)
    .where(and(...conditions))
    .orderBy(desc(reservations.createdAt))
    .limit(limit)
    .offset(offset)

  return json({ reservations: rows })
}

async function handleStore(storeId: string) {
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

  if (!store) return error('Store not found', 404)
  return json({ store })
}

// ============================================================================
// Route mapping
// ============================================================================

const ROUTES: Record<string, { handler: RouteHandler; scope: string }> = {
  products: { handler: handleProducts, scope: 'products:read' },
  customers: { handler: handleCustomers, scope: 'customers:read' },
  reservations: { handler: handleReservations, scope: 'reservations:read' },
}

async function handleRequest(request: NextRequest) {
  // Authenticate
  const auth = await authenticate(request)
  if (!auth) {
    return error('Invalid or missing API key', 401)
  }

  // Parse path: /api/v1/products/123 → ['products', '123']
  const url = new URL(request.url)
  const pathAfterV1 = url.pathname.replace(/^\/api\/v1\/?/, '')
  const segments = pathAfterV1.split('/').filter(Boolean)
  const resource = segments[0]

  if (!resource) {
    return json({
      name: 'Louez API',
      version: 'v1',
      endpoints: ['products', 'customers', 'reservations', 'store'],
    })
  }

  // Handle /store separately (always accessible)
  if (resource === 'store') {
    return handleStore(auth.storeId)
  }

  const route = ROUTES[resource]
  if (!route) {
    return error(`Unknown resource: ${resource}`, 404)
  }

  // Check scope
  if (!auth.scopes.includes(route.scope)) {
    return error(`Missing scope: ${route.scope}`, 403)
  }

  return route.handler(auth.storeId, auth.scopes, request, segments.slice(1))
}

export const GET = handleRequest
