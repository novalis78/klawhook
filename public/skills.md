# KlawHook - Webhooks for Agents

**Service:** KlawHook
**API Base:** `https://api.klawhook.xyz`
**Purpose:** Create webhook URLs and poll for incoming webhook events without needing a public endpoint

## What This Service Does

KlawHook lets you receive webhooks from external services (GitHub, Stripe, etc.) without exposing a public server. Create a unique webhook URL, give it to any service, then poll for incoming events via REST API.

## Authentication

All requests require a KlawKeeper API key:

```bash
Authorization: Bearer YOUR_KLAWKEEPER_API_KEY
```

Get your API key at [klawkeeper.xyz](https://klawkeeper.xyz)

## Core Endpoints

### 1. Create a Hook

```bash
POST https://api.klawhook.xyz/hooks
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "name": "my-github-webhook",
  "description": "GitHub push events"
}
```

**Response:**
```json
{
  "hook_id": "vgctbpvG0MFt",
  "webhook_url": "https://api.klawhook.xyz/webhook/vgctbpvG0MFt",
  "created_at": "2025-01-15T10:30:00Z"
}
```

**What to do:** Give the `webhook_url` to external services (GitHub webhooks settings, Stripe dashboard, etc.)

### 2. Poll for Events

```bash
GET https://api.klawhook.xyz/hooks/vgctbpvG0MFt/events
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "events": [
    {
      "event_id": "evt_abc123",
      "received_at": "2025-01-15T10:35:22Z",
      "method": "POST",
      "headers": {
        "content-type": "application/json",
        "x-github-event": "push"
      },
      "body": {
        "ref": "refs/heads/main",
        "commits": [...]
      },
      "source_ip": "140.82.115.0"
    }
  ],
  "count": 1
}
```

### 3. Get Specific Event

```bash
GET https://api.klawhook.xyz/hooks/vgctbpvG0MFt/events/evt_abc123
Authorization: Bearer YOUR_API_KEY
```

**Response:** Single event object with full details (headers, body, metadata)

### 4. Acknowledge Event

Mark an event as processed (removes from queue):

```bash
DELETE https://api.klawhook.xyz/hooks/vgctbpvG0MFt/events/evt_abc123
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "acknowledged": true,
  "event_id": "evt_abc123"
}
```

### 5. List Your Hooks

```bash
GET https://api.klawhook.xyz/hooks
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "hooks": [
    {
      "hook_id": "vgctbpvG0MFt",
      "name": "my-github-webhook",
      "webhook_url": "https://api.klawhook.xyz/webhook/vgctbpvG0MFt",
      "event_count": 3,
      "created_at": "2025-01-15T10:30:00Z"
    }
  ]
}
```

### 6. Delete a Hook

```bash
DELETE https://api.klawhook.xyz/hooks/vgctbpvG0MFt
Authorization: Bearer YOUR_API_KEY
```

## Common Use Cases

### GitHub Webhooks
1. Create hook → get webhook URL
2. Add URL to GitHub repo settings (Settings → Webhooks)
3. Poll `/hooks/{id}/events` to see push/PR/issue events
4. Acknowledge events after processing

### Stripe Webhooks
1. Create hook → get webhook URL
2. Add URL to Stripe dashboard (Developers → Webhooks)
3. Poll for payment events (`payment_intent.succeeded`, etc.)
4. Acknowledge after fulfilling order

### Custom Integrations
Any service that can POST to a URL can send webhooks to KlawHook.

## Notification Options

KlawHook can also push events to you:

### Nostr DMs
Specify `nostr_pubkey` when creating hook - events sent as Nostr DMs in real-time

### Email
Specify `email` when creating hook - events sent to your KlawKeeper email

```bash
POST https://api.klawhook.xyz/hooks
{
  "name": "urgent-alerts",
  "nostr_pubkey": "npub1...",
  "email": "agent@klawkeeper.xyz"
}
```

## Pricing

- **Create hook:** 10 credits
- **Receive event:** 1 credit per event
- **Poll events:** 1 credit per request
- **Acknowledge event:** 0 credits (free)
- **Nostr notification:** +2 credits per event
- **Email notification:** +5 credits per event

Events are retained for 7 days. Fund your account at [klawkeeper.xyz](https://klawkeeper.xyz)

## Example Flow

```bash
# 1. Create a hook
curl -X POST https://api.klawhook.xyz/hooks \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "stripe-payments"}'

# Response: {"webhook_url": "https://api.klawhook.xyz/webhook/abc123"}

# 2. External service sends webhook
# (Stripe POSTs to your webhook_url)

# 3. Poll for events (in your agent loop)
curl https://api.klawhook.xyz/hooks/abc123/events \
  -H "Authorization: Bearer YOUR_API_KEY"

# 4. Process event, then acknowledge
curl -X DELETE https://api.klawhook.xyz/hooks/abc123/events/evt_xyz \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Error Codes

- `401` - Missing or invalid API key
- `404` - Hook or event not found
- `402` - Insufficient credits
- `429` - Rate limit exceeded (100 requests/minute)

## Rate Limits

- Poll requests: 100/minute
- Create hooks: 10/minute
- Webhook ingestion: 1000/minute

## Support

Part of the KlawStack ecosystem. Managed by KlawKeeper.

**Docs:** [klawhook.xyz](https://klawhook.xyz)
**Identity/Auth:** [klawkeeper.xyz](https://klawkeeper.xyz)
**Full Stack:** [klawstack.xyz](https://klawstack.xyz)
