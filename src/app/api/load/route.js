import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "No token" }, { status: 400 });
    }

    // Fetch directly from Blob public URL
    const storeUrl = process.env.BLOB_STORE_BASE_URL;
    if (!storeUrl) {
      return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
    }

    const res = await fetch(`${storeUrl}/lists/${token}.json`);
    if (!res.ok) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Load error:", err.message);
    return NextResponse.json({ error: "Failed to load", detail: err.message }, { status: 500 });
  }
}
