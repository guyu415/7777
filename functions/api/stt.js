const STT_UPSTREAM = 'https://chat.xiaoman.xyz/stt'

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

export async function onRequest(context) {
  const { request } = context
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...JSON_HEADERS, Allow: 'POST' },
    })
  }

  const contentType = request.headers.get('Content-Type') || ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    return new Response(JSON.stringify({ error: 'multipart form required' }), {
      status: 415,
      headers: JSON_HEADERS,
    })
  }

  try {
    // Buffering at this hop is intentional: it avoids request-stream quirks in
    // WebKit/Pages while the Worker still enforces the 1.1 MB audio limit.
    const body = await request.arrayBuffer()
    const upstream = await fetch(STT_UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Accept: 'application/json',
      },
      body,
    })
    const headers = new Headers(upstream.headers)
    headers.set('Cache-Control', 'no-store')
    headers.delete('Set-Cookie')
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    })
  } catch (error) {
    console.error('[PAGES STT] upstream failed:', error?.message || String(error))
    return new Response(JSON.stringify({ error: 'STT gateway unavailable' }), {
      status: 502,
      headers: JSON_HEADERS,
    })
  }
}
