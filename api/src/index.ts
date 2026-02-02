import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { cleanupOldEvents } from './db.js';
import hooks from './routes/hooks.js';
import webhook from './routes/webhook.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'keyhook',
  timestamp: new Date().toISOString(),
}));

// API info
app.get('/', (c) => c.json({
  service: 'KeyHook API',
  version: '0.1.0',
  description: 'Webhook receiver for autonomous AI agents',
  documentation: 'https://keyhook.world',
  endpoints: {
    hooks: '/hooks - Manage webhook endpoints (requires auth)',
    webhook: '/webhook/:id - Receive incoming webhooks (public)',
  },
}));

// Mount routes
app.route('/hooks', hooks);
app.route('/webhook', webhook);

// OpenAPI spec for AI agent discovery and APIs.guru
const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'KeyHook API',
    description: 'Webhook receiver for AI agents. Create webhook URLs, receive events from external services (GitHub, Stripe, etc), poll events via REST API. No public endpoint needed on the agent side.',
    version: '1.0.0',
    contact: {
      name: 'KeyHook Support',
      url: 'https://keyhook.world',
      email: 'support@keyhook.world'
    },
    'x-logo': {
      url: 'https://keyhook.world/logo.png'
    }
  },
  servers: [
    { url: 'https://api.keyhook.world', description: 'Production' }
  ],
  tags: [
    { name: 'Hooks', description: 'Manage webhook endpoints' },
    { name: 'Events', description: 'Retrieve received webhook events' },
    { name: 'Webhook Receiver', description: 'Public endpoint for external services' }
  ],
  paths: {
    '/hooks': {
      post: {
        tags: ['Hooks'],
        summary: 'Create a webhook endpoint',
        description: 'Create a new webhook endpoint. Returns a unique webhook URL that external services can POST to.',
        operationId: 'createHook',
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Human-readable name', example: 'github-events' },
                  description: { type: 'string', description: 'What this hook receives' },
                  delivery_method: { type: 'string', enum: ['poll', 'nostr', 'email'], default: 'poll' }
                }
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Webhook endpoint created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Hook' },
                example: {
                  id: 'vgctbpvG0MFt',
                  webhook_url: 'https://api.keyhook.world/webhook/vgctbpvG0MFt',
                  name: 'github-events',
                  delivery_method: 'poll',
                  created_at: '2025-12-03T22:32:53.671Z'
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' }
        }
      },
      get: {
        tags: ['Hooks'],
        summary: 'List all webhook endpoints',
        operationId: 'listHooks',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'List of webhook endpoints',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    hooks: { type: 'array', items: { $ref: '#/components/schemas/Hook' } }
                  }
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' }
        }
      }
    },
    '/hooks/{id}': {
      get: {
        tags: ['Hooks'],
        summary: 'Get webhook endpoint details',
        operationId: 'getHook',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/HookId' }],
        responses: {
          '200': { description: 'Hook details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Hook' } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      },
      delete: {
        tags: ['Hooks'],
        summary: 'Delete webhook endpoint',
        operationId: 'deleteHook',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/HookId' }],
        responses: {
          '200': { description: 'Webhook deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      }
    },
    '/hooks/{id}/events': {
      get: {
        tags: ['Events'],
        summary: 'Poll for webhook events',
        description: 'Retrieve webhook events. Use ?undelivered=true for new events only.',
        operationId: 'getEvents',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/HookId' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
          { name: 'undelivered', in: 'query', schema: { type: 'boolean', default: false } },
          { name: 'mark_delivered', in: 'query', schema: { type: 'boolean', default: true } }
        ],
        responses: {
          '200': {
            description: 'List of events',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    events: { type: 'array', items: { $ref: '#/components/schemas/Event' } },
                    count: { type: 'integer' },
                    has_more: { type: 'boolean' }
                  }
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      }
    },
    '/webhook/{id}': {
      post: {
        tags: ['Webhook Receiver'],
        summary: 'Receive a webhook (public endpoint)',
        description: 'Public endpoint for external services like GitHub, Stripe, etc. No authentication required.',
        operationId: 'receiveWebhook',
        parameters: [{ $ref: '#/components/parameters/HookId' }],
        requestBody: {
          content: {
            'application/json': { schema: { type: 'object' } },
            'application/x-www-form-urlencoded': { schema: { type: 'object' } },
            '*/*': { schema: { type: 'string' } }
          }
        },
        responses: {
          '200': {
            description: 'Webhook received',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { received: { type: 'boolean' }, event_id: { type: 'string' } } },
                example: { received: true, event_id: 'y0HypLl8h3fzVrdu' }
              }
            }
          },
          '404': { $ref: '#/components/responses/NotFound' }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'KeyKeeper API token from keykeeper.world'
      }
    },
    parameters: {
      HookId: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        example: 'vgctbpvG0MFt'
      }
    },
    schemas: {
      Hook: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          webhook_url: { type: 'string', format: 'uri' },
          name: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
          delivery_method: { type: 'string', enum: ['poll', 'nostr', 'email'] },
          created_at: { type: 'string', format: 'date-time' },
          last_triggered_at: { type: 'string', format: 'date-time', nullable: true },
          event_count: { type: 'integer' }
        }
      },
      Event: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          method: { type: 'string' },
          headers: { type: 'object' },
          body: { },
          query_params: { type: 'object', nullable: true },
          source_ip: { type: 'string' },
          received_at: { type: 'string', format: 'date-time' },
          delivered_at: { type: 'string', format: 'date-time', nullable: true }
        }
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } }
      }
    },
    responses: {
      Unauthorized: {
        description: 'Missing or invalid authentication',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Missing or invalid Authorization header' } } }
      },
      NotFound: {
        description: 'Resource not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Webhook not found' } } }
      }
    }
  }
};

app.get('/openapi.json', (c) => c.json(openapiSpec));

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Start server
const port = parseInt(process.env.PORT || '3002');

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                     KeyHook API                           ║
║         Webhook receiver for autonomous AI agents         ║
╠═══════════════════════════════════════════════════════════╣
║  Endpoints:                                               ║
║    POST   /hooks           Create webhook endpoint        ║
║    GET    /hooks           List your hooks                ║
║    GET    /hooks/:id       Get hook details               ║
║    DELETE /hooks/:id       Delete a hook                  ║
║    GET    /hooks/:id/events   Poll for events             ║
║    *      /webhook/:id     Receive webhooks (public)      ║
╚═══════════════════════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});

// Cleanup old events every hour
setInterval(() => {
  const deleted = cleanupOldEvents();
  if (deleted > 0) {
    console.log(`Cleaned up ${deleted} old events`);
  }
}, 60 * 60 * 1000);
