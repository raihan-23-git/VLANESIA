// Vercel Function berbasis Web Request / Response.
// Logika API digunakan bersama dengan server lokal agar perilaku tetap konsisten.
import backend from '../server.js';

export default async function handler(request) {
  const u = new URL(request.url);
  const route = u.searchParams.get('route') || '';
  if (!/^[a-zA-Z0-9/_-]{1,80}$/.test(route)) {
    return Response.json({ error: 'Endpoint tidak valid' }, { status: 400 });
  }
  let parsedBody = {};
  if (['POST', 'PATCH', 'PUT'].includes(request.method)) {
    try {
      const text = await request.text();
      if (text.length > 200000) return Response.json({ error: 'Payload terlalu besar' }, { status: 413 });
      parsedBody = text ? JSON.parse(text) : {};
    } catch {
      return Response.json({ error: 'Format JSON tidak valid' }, { status: 400 });
    }
  }
  let status = 200;
  let headers = {};
  let content = '';
  const response = {
    writeHead(code, h) { status = code; headers = h; },
    end(data) { content = data ?? ''; }
  };
  await backend.api({ method: request.method, body: parsedBody }, response, '/api/' + route);
  return new Response(content, { status, headers });
}
