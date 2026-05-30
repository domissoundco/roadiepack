import { NextResponse } from "next/server";
import { list } from "@vercel/blob";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    console.log("Load called, token:", token);

    if (!token) {
      return NextResponse.json({ error: "No token" }, { status: 400 });
    }

    const prefix = `lists/${token}.json`;
    console.log("Looking for blob:", prefix);

    const { blobs } = await list({ prefix });
    console.log("Blobs found:", blobs.length, blobs.map(b => b.url));

    if (!blobs.length) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const res  = await fetch(blobs[0].url);
    const data = await res.json();
    console.log("Loaded name:", data.name);

    return NextResponse.json(data);
  } catch (err) {
    console.error("Load error:", err.message);
    return NextResponse.json({ error: "Failed to load", detail: err.message }, { status: 500 });
  }
}
