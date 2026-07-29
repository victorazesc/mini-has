import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const serverUrl = process.env.SERVER_URL;
  if (!serverUrl) {
    return NextResponse.json({ message: "Servidor não configurado." }, { status: 500 });
  }

  const form = await request.formData();
  const body = Object.fromEntries(
    Array.from(form.entries())
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const csrfCookieName = process.env.MINI_HAS_CSRF_COOKIE || "mini_has_xsrf";
  const csrfToken = request.cookies.get(csrfCookieName)?.value || "";

  try {
    const backendResponse = await fetch(`${serverUrl}/oauth/authorize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: request.headers.get("cookie") || "",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(body),
      redirect: "manual",
      cache: "no-store",
    });
    const location = backendResponse.headers.get("location");
    if (backendResponse.status >= 300 && backendResponse.status < 400 && location) {
      return NextResponse.redirect(location, 302);
    }
    const payload = await backendResponse.json().catch(() => null);
    return NextResponse.json(payload || { message: "Falha ao autorizar." }, {
      status: backendResponse.status,
    });
  } catch {
    return NextResponse.json({ message: "Mini HAS indisponível." }, { status: 503 });
  }
}
