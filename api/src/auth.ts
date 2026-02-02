import { Context, MiddlewareHandler } from 'hono';

const KEYKEEPER_API = process.env.KEYKEEPER_API || 'https://keykeeper.world/api';
const SERVICE_SECRET = process.env.SERVICE_SECRET || '';

// Token cache (TTL 60 seconds)
const tokenCache = new Map<string, { result: TokenValidation; expires: number }>();
const TOKEN_CACHE_TTL = 60000;

export interface TokenValidation {
  valid: boolean;
  user_id?: string;
  email?: string;
  credits?: number;
  error?: string;
}

export interface AuthContext {
  token: string;
  userId?: string;
  email?: string;
  credits: number;
}

// Verify token against KeyKeeper API (same as keyfetch)
export async function verifyToken(token: string, operation: string = 'webhook_operation'): Promise<TokenValidation> {
  if (!token) {
    return { valid: false, error: 'No token provided' };
  }

  // Check cache first
  const cached = tokenCache.get(token);
  if (cached && cached.expires > Date.now()) {
    return cached.result;
  }

  try {
    const response = await fetch(`${KEYKEEPER_API}/v1/services/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Secret': SERVICE_SECRET,
      },
      body: JSON.stringify({
        token,
        service: 'keyhook',
        operation,
        quantity: 1,
      }),
    });

    const data = await response.json() as TokenValidation;

    // Cache successful verifications
    if (data.valid) {
      tokenCache.set(token, {
        result: data,
        expires: Date.now() + TOKEN_CACHE_TTL,
      });
    }

    return data;
  } catch (error) {
    console.error('KeyKeeper verification error:', error);
    return { valid: false, error: 'Authentication service unavailable' };
  }
}

// Report usage to KeyKeeper (for billing)
export async function reportUsage(records: Array<{ token: string; operation: string; quantity: number }>): Promise<boolean> {
  if (records.length === 0) return true;

  try {
    const response = await fetch(`${KEYKEEPER_API}/v1/services/usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Secret': SERVICE_SECRET,
      },
      body: JSON.stringify({
        service: 'keyhook',
        records,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Failed to report usage:', error);
    return false;
  }
}

// Authentication middleware for Hono
export const authMiddleware: MiddlewareHandler = async (c: Context, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.substring(7);

  if (!token) {
    return c.json({ error: 'API token required' }, 401);
  }

  // Verify with KeyKeeper
  const validation = await verifyToken(token, 'webhook_access');

  if (!validation.valid) {
    return c.json({
      error: validation.error || 'Invalid token',
    }, 401);
  }

  // Store auth context for route handlers
  c.set('auth', {
    token,
    userId: validation.user_id,
    email: validation.email,
    credits: validation.credits || 0,
  } as AuthContext);

  await next();
};

// Get auth context from request
export function getAuth(c: Context): AuthContext {
  return c.get('auth') as AuthContext;
}
