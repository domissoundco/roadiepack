import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "No token" }, { status: 400 });
    }

    // Fetch the blob directly by its public URL pattern
    const baseUrl  = process.env.NEXT_PUBLIC_BASE_URL || "https://roadiepack.vercel.app";
    const blobBase = process.env.BLOB_STORE_BASE_URL;

    if (!blobBase) {
      return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
    }

    const blobUrl = `${blobBase}/lists/${token}.json`;
    const res     = await fetch(blobUrl);

    if (!res.ok) {
      return NextResponse.json({ error: "List not found or expired" }, { status: 404 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Load error:", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
