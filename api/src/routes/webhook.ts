import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { statements, Hook } from '../db.js';

const webhook = new Hono();

// Headers to exclude from storage (too large or sensitive)
const EXCLUDED_HEADERS = new Set([
  'cookie',
  'authorization',
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
]);

// Maximum body size to store (100KB)
const MAX_BODY_SIZE = 100 * 1024;

// Handle incoming webhook - all HTTP methods
webhook.all('/:id', async (c) => {
  const hookId = c.req.param('id');
  const method = c.req.method;

  try {
    // Find the hook
    const hook = statements.getHook.get(hookId) as Hook | undefined;

    if (!hook) {
      // Return 200 even for unknown hooks to prevent enumeration
      // and to not break integrations if hook was deleted
      return c.json({ received: true });
    }

    // Extract request data
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      if (!EXCLUDED_HEADERS.has(key.toLowerCase())) {
        headers[key] = value;
      }
    });

    // Get query params
    const url = new URL(c.req.url);
    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });

    // Get body (for methods that have one)
    let body: string | null = null;
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      try {
        const rawBody = await c.req.text();
        if (rawBody.length <= MAX_BODY_SIZE) {
          body = rawBody;
        } else {
          body = JSON.stringify({
            _truncated: true,
            _original_size: rawBody.length,
            _preview: rawBody.substring(0, 1000),
          });
        }
      } catch {
        body = null;
      }
    }

    // Get source IP
    const sourceIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
                     c.req.header('x-real-ip') ||
                     c.req.header('cf-connecting-ip') ||
                     null;

    // Create event
    const eventId = nanoid(16);
    statements.createEvent.run(
      eventId,
      hookId,
      method,
      JSON.stringify(headers),
      body,
      Object.keys(queryParams).length > 0 ? JSON.stringify(queryParams) : null,
      sourceIp
    );

    // Update hook trigger stats
    statements.updateHookTrigger.run(hookId);

    // Handle delivery based on method
    if (hook.delivery_method !== 'poll' && hook.delivery_config) {
      // Queue for async delivery (Nostr/email)
      // For now, we just store - delivery can be added later
      await deliverEvent(hook, eventId, {
        method,
        headers,
        body,
        query_params: queryParams,
        source_ip: sourceIp,
      });
    }

    // Return success - important for external services
    return c.json({ received: true, event_id: eventId });
  } catch (error) {
    console.error('Webhook processing error:', error);
    // Still return 200 to prevent retries flooding us
    return c.json({ received: true });
  }
});

// Async event delivery (placeholder for Nostr/email)
async function deliverEvent(
  hook: Hook,
  eventId: string,
  data: {
    method: string;
    headers: Record<string, string>;
    body: string | null;
    query_params: Record<string, string>;
    source_ip: string | null;
  }
): Promise<void> {
  if (!hook.delivery_config) return;

  try {
    const config = JSON.parse(hook.delivery_config) as {
      nostr_pubkey?: string;
      nostr_relay?: string;
      email?: string;
    };

    switch (hook.delivery_method) {
      case 'nostr':
        // TODO: Send via Nostr DM
        // Would need nostr-tools and signing key
        console.log(`[Nostr delivery] Event ${eventId} to ${config.nostr_pubkey}`);
        break;

      case 'email':
        // TODO: Send via email
        // Would need SMTP or email service integration
        console.log(`[Email delivery] Event ${eventId} to ${config.email}`);
        break;

      default:
        // Poll - no active delivery needed
        break;
    }

    // Mark as delivered
    statements.markEventsDelivered.run(eventId);
  } catch (error) {
    console.error(`Failed to deliver event ${eventId}:`, error);
  }
}

export default webhook;
