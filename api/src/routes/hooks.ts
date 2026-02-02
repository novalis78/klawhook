import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { statements, Hook, Event } from '../db.js';
import { authMiddleware, getAuth } from '../auth.js';

const hooks = new Hono();

// All routes require authentication
hooks.use('*', authMiddleware);

// Create a new webhook endpoint
hooks.post('/', async (c) => {
  const auth = getAuth(c);
  const body = await c.req.json().catch(() => ({})) as {
    name?: string;
    description?: string;
    delivery_method?: 'poll' | 'nostr' | 'email';
    delivery_config?: Record<string, unknown>;
  };

  const hookId = nanoid(12);
  const deliveryMethod = body.delivery_method || 'poll';
  const deliveryConfig = body.delivery_config ? JSON.stringify(body.delivery_config) : null;

  try {
    statements.createHook.run(
      hookId,
      auth.token,
      body.name || null,
      body.description || null,
      deliveryMethod,
      deliveryConfig
    );

    const webhookUrl = `${process.env.PUBLIC_URL || 'https://api.klawhook.xyz'}/webhook/${hookId}`;

    return c.json({
      id: hookId,
      webhook_url: webhookUrl,
      name: body.name || null,
      description: body.description || null,
      delivery_method: deliveryMethod,
      created_at: new Date().toISOString(),
    }, 201);
  } catch (error) {
    console.error('Failed to create hook:', error);
    return c.json({ error: 'Failed to create webhook endpoint' }, 500);
  }
});

// List all hooks for the authenticated user
hooks.get('/', (c) => {
  const auth = getAuth(c);

  try {
    const hooksList = statements.getHooksByApiKey.all(auth.token) as Hook[];
    const publicUrl = process.env.PUBLIC_URL || 'https://api.klawhook.xyz';

    return c.json({
      hooks: hooksList.map((hook) => ({
        id: hook.id,
        webhook_url: `${publicUrl}/webhook/${hook.id}`,
        name: hook.name,
        description: hook.description,
        delivery_method: hook.delivery_method,
        created_at: hook.created_at,
        last_triggered_at: hook.last_triggered_at,
        event_count: hook.event_count,
      })),
    });
  } catch (error) {
    console.error('Failed to list hooks:', error);
    return c.json({ error: 'Failed to list webhooks' }, 500);
  }
});

// Get a specific hook
hooks.get('/:id', (c) => {
  const auth = getAuth(c);
  const hookId = c.req.param('id');

  try {
    const hook = statements.getHook.get(hookId) as Hook | undefined;

    if (!hook) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    if (hook.api_key !== auth.token) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    const publicUrl = process.env.PUBLIC_URL || 'https://api.klawhook.xyz';

    return c.json({
      id: hook.id,
      webhook_url: `${publicUrl}/webhook/${hook.id}`,
      name: hook.name,
      description: hook.description,
      delivery_method: hook.delivery_method,
      delivery_config: hook.delivery_config ? JSON.parse(hook.delivery_config) : null,
      created_at: hook.created_at,
      last_triggered_at: hook.last_triggered_at,
      event_count: hook.event_count,
    });
  } catch (error) {
    console.error('Failed to get hook:', error);
    return c.json({ error: 'Failed to get webhook' }, 500);
  }
});

// Delete a hook
hooks.delete('/:id', (c) => {
  const auth = getAuth(c);
  const hookId = c.req.param('id');

  try {
    const result = statements.deleteHook.run(hookId, auth.token);

    if (result.changes === 0) {
      return c.json({ error: 'Webhook not found or unauthorized' }, 404);
    }

    return c.json({ success: true, message: 'Webhook deleted' });
  } catch (error) {
    console.error('Failed to delete hook:', error);
    return c.json({ error: 'Failed to delete webhook' }, 500);
  }
});

// Poll events for a hook
hooks.get('/:id/events', async (c) => {
  const auth = getAuth(c);
  const hookId = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const undeliveredOnly = c.req.query('undelivered') === 'true';
  const markDelivered = c.req.query('mark_delivered') !== 'false';

  try {
    // Verify hook ownership
    const hook = statements.getHook.get(hookId) as Hook | undefined;

    if (!hook) {
      return c.json({ error: 'Webhook not found' }, 404);
    }

    if (hook.api_key !== auth.token) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    // Get events
    const events = undeliveredOnly
      ? (statements.getUndeliveredEvents.all(hookId, limit) as Event[])
      : (statements.getEvents.all(hookId, limit) as Event[]);

    // Mark events as delivered if requested
    if (markDelivered && events.length > 0) {
      for (const event of events) {
        if (!event.delivered_at) {
          statements.markEventsDelivered.run(event.id);
        }
      }
    }

    return c.json({
      events: events.map((event) => ({
        id: event.id,
        method: event.method,
        headers: JSON.parse(event.headers),
        body: event.body ? tryParseJson(event.body) : null,
        query_params: event.query_params ? JSON.parse(event.query_params) : null,
        source_ip: event.source_ip,
        received_at: event.received_at,
        delivered_at: event.delivered_at,
      })),
      count: events.length,
      has_more: events.length === limit,
    });
  } catch (error) {
    console.error('Failed to get events:', error);
    return c.json({ error: 'Failed to get events' }, 500);
  }
});

// Helper to safely parse JSON
function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

export default hooks;
