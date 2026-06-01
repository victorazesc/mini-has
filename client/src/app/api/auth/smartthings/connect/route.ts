import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

export async function GET() {
    const clientId = process.env.SMARTTHINGS_CLIENT_ID;
    const redirectUri = process.env.SMARTTHINGS_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return NextResponse.json(
            {
                error: "Missing SMARTTHINGS_CLIENT_ID or SMARTTHINGS_REDIRECT_URI",
                clientIdExists: !!clientId,
                redirectUriExists: !!redirectUri,
            },
            { status: 500 }
        );
    }

    const scopes = (process.env.SMARTTHINGS_SCOPES || "r:devices:* x:devices:*").trim();
    const state = randomUUID();

    const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        scope: scopes,
        redirect_uri: redirectUri,
        state,
    });

    const authorizationUrl = `https://api.smartthings.com/oauth/authorize?${params.toString()}`;

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set("smartthings_oauth_state", state, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/api/auth/smartthings",
        maxAge: 10 * 60,
    });

    return response;
}
