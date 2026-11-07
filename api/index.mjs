
// Vercel Function berbasis Web Request / Response.
// Logika API digunakan bersama dengan server lokal agar perilaku tetap konsisten.

import backend from '../server.js';

export default async function handler(request) {
  try {
    // Membuat URL lengkap agar tidak terjadi error Invalid URL.
    const host = request.headers.get('host') || 'localhost';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const u = new URL(request.url, `${protocol}://${host}`);

    const route = u.searchParams.get('route') || '';

    // Validasi endpoint.
    if (!/^[a-zA-Z0-9/_-]{1,80}$/.test(route)) {
      return Response.json(
        { error: 'Endpoint tidak valid' },
        { status: 400 }
      );
    }

    // Membaca body untuk request yang membutuhkan data.
    let parsedBody = {};

    if (['POST', 'PATCH', 'PUT'].includes(request.method)) {
      try {
        const text = await request.text();

        if (text.length > 200000) {
          return Response.json(
            { error: 'Payload terlalu besar' },
            { status: 413 }
          );
        }

        parsedBody = text ? JSON.parse(text) : {};
      } catch {
        return Response.json(
          { error: 'Format JSON tidak valid' },
          { status: 400 }
        );
      }
    }

    // Menampung respons dari backend.
    let status = 200;
    let headers = {};
    let content = '';

    const response = {
      writeHead(code, responseHeaders = {}) {
        status = code;
        headers = responseHeaders;
      },

      end(data) {
        content = data ?? '';
      }
    };

    // Menjalankan backend API.
    await backend.api(
      {
        method: request.method,
        body: parsedBody
      },
      response,
      '/api/' + route
    );

    // Mengembalikan respons ke browser.
    return new Response(content, {
      status,
      headers
    });

  } catch (error) {
    console.error('Vercel API Error:', error);

    return Response.json(
      {
        error: 'Terjadi kesalahan pada server',
        message: error.message
      },
      { status: 500 }
    );
  }
}
