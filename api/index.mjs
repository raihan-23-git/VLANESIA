
export default async function handler(request) {
  return Response.json({
    ok: true,
    app: 'VLANesia',
    message: 'Vercel Function berjalan normal',
    timestamp: new Date().toISOString(),
    url: request.url
  });
}
