import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "No token" }, { status: 400 });
    }

    const storeUrl = "https://wjtdqyontda5abo7.public.blob.vercel-storage.com";
    const blobUrl  = `${storeUrl}/lists/${token}.json`;

    console.log("Fetching:", blobUrl);

    const res = await fetch(blobUrl);

    console.log("Blob response status:", res.status);

    if (!res.ok) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const data = await res.json();
    console.log("Loaded name:", data.name);

    return NextResponse.json(data);
  } catch (err) {
    console.error("Load error:", err.message);
    return NextResponse.json({ error: "Failed to load", detail: err.message }, { status: 500 });
  }
}
