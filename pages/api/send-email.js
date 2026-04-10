/**
 * Server-side email sending route via Resend.
 *
 * The RESEND_API_KEY never touches the browser — it's read from
 * the server environment only. Add it in Vercel → Settings → Environment Variables.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { to, subject, text, from } = req.body;

  if (!to || !subject || !text || !from) {
    return res.status(400).json({ error: "Missing required fields: to, subject, text, from" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY is not configured on the server. Add it in Vercel → Settings → Environment Variables." });
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Resend error:", data);
      return res.status(response.status).json({ error: data.message || "Resend API error", details: data });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("send-email route error:", error);
    return res.status(500).json({ error: error.message });
  }
}
