export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
      return Response.json({ error: "No token" }, { status: 400 });
    }

    const blobUrl = `https://wjtdqyontda5abo7.public.blob.vercel-storage.com/roadiepack/lists/${token}.json`;

    const res  = await fetch(blobUrl);
    const text = await res.text();

    if (!res.ok) {
      return Response.json({ error: "Not found", status: res.status, url: blobUrl }, { status: 404 });
    }

    const data = JSON.parse(text);
    return Response.json(data);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
