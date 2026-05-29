import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { Resend } from "resend";
import { randomBytes } from "crypto";

export async function POST(req) {
  try {
    const { name, email, state } = await req.json();

    if (!name || !email || !state) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const token = randomBytes(16).toString("hex");
    const data  = { name, email, state, savedAt: Date.now() };

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    console.log("Blob token present:", !!blobToken, "length:", blobToken?.length);

    try {
      await put(`lists/${token}.json`, JSON.stringify(data), {
        access: "public",
        contentType: "application/json",
        token: blobToken,
      });
    } catch (blobErr) {
      console.error("Blob error:", blobErr.message);
      return NextResponse.json({ error: "Storage failed", detail: blobErr.message }, { status: 500 });
    }

    const baseUrl   = process.env.NEXT_PUBLIC_BASE_URL || "https://roadiepack.vercel.app";
    const magicLink = `${baseUrl}/?token=${token}`;
    const resend    = new Resend(process.env.RESEND_API_KEY);

    try {
      await resend.emails.send({
        from: "Roadie Pack <roadiepack@domissound.co>",
        to: email,
        subject: `${name}'s packing list — Roadie Pack`,
        html: `
          <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
            <h1 style="font-size: 32px; font-weight: 300; margin: 0 0 8px; letter-spacing: -1px;">Roadie Pack</h1>
            <p style="color: #78716c; font-style: italic; margin: 0 0 32px;">Less in the bag. More on the road.</p>
            <p style="font-size: 16px; margin: 0 0 24px;">Hey ${name} — here's your packing list link.</p>
            <a href="${magicLink}" style="display: inline-block; padding: 14px 28px; background: #1a3a1a; color: #fff; text-decoration: none; font-size: 14px; letter-spacing: 0.5px;">
              Open my list →
            </a>
            <p style="margin: 32px 0 0; font-size: 12px; color: #78716c;">Restores your exact setup — mode, days, destinations, everything.</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error("Email error:", emailErr.message);
      return NextResponse.json({ success: true, token, warning: "List saved but email failed" });
    }

    return NextResponse.json({ success: true, token });
  } catch (err) {
    console.error("Save error:", err.message);
    return NextResponse.json({ error: "Failed to save", detail: err.message }, { status: 500 });
  }
}
