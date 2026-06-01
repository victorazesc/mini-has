import { NextRequest, NextResponse } from "next/server";

const SMARTTHINGS_TOKEN_URL = "https://api.smartthings.com/oauth/token";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;

    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const state = searchParams.get("state");
    const expectedState = request.cookies.get("smartthings_oauth_state")?.value;

    if (error) {
        return NextResponse.json(
            { error: "SmartThings authorization error", details: error },
            { status: 400 }
        );
    }

    if (!code) {
        return NextResponse.json(
            { error: "Missing authorization code" },
            { status: 400 }
        );
    }

    if (!state || !expectedState || state !== expectedState) {
        return NextResponse.json(
            { error: "Invalid SmartThings OAuth state" },
            { status: 400 }
        );
    }

    const clientId = process.env.SMARTTHINGS_CLIENT_ID;
    const clientSecret = process.env.SMARTTHINGS_CLIENT_SECRET;
    const redirectUri = process.env.SMARTTHINGS_REDIRECT_URI;
    const serverUrl = process.env.SERVER_URL;

    if (!clientId || !clientSecret || !redirectUri || !serverUrl) {
        return NextResponse.json(
            { error: "Missing SmartThings or backend environment variables" },
            { status: 500 }
        );
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
    });

    const tokenResponse = await fetch(SMARTTHINGS_TOKEN_URL, {
        method: "POST",
        headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
    });

    const tokenData = await readJsonResponse(tokenResponse);
    const accessToken = stringValue(tokenData.access_token);
    const refreshToken = stringValue(tokenData.refresh_token);

    if (!tokenResponse.ok || !accessToken || !refreshToken) {
        return NextResponse.json(
            {
                error: "Failed to exchange SmartThings code for token",
                status: tokenResponse.status,
                details: tokenData,
            },
            { status: tokenResponse.status }
        );
    }

    const integrationResponse = await fetch(`${serverUrl}/integrations`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: "SmartThings Cloud",
            type: "smartthings_cloud",
            config: {
                authType: "oauth2",
                clientId,
                clientSecret,
                accessToken,
                refreshToken,
                tokenType: tokenData.token_type,
                expiresIn: tokenData.expires_in,
                expiresAt: expiresAtFrom(tokenData.expires_in),
                scope: tokenData.scope,
            },
        }),
    });

    const integration = await readJsonResponse(integrationResponse);
    const integrationId = Number(integration.id);

    if (!integrationResponse.ok || !Number.isFinite(integrationId)) {
        return NextResponse.json(
            {
                error: "Failed to save SmartThings integration",
                status: integrationResponse.status,
                details: integration,
            },
            { status: integrationResponse.status }
        );
    }

    const syncResponse = await fetch(`${serverUrl}/integrations/${integrationId}/sync`, {
        method: "POST",
    });
    const syncData = await readJsonResponse(syncResponse);

    const redirectUrl = new URL("/devices", publicOrigin(request, redirectUri));
    redirectUrl.searchParams.set("smartthings", syncResponse.ok && syncData.ok !== false ? "connected" : "sync_error");
    redirectUrl.searchParams.set("integrationId", String(integrationId));
    if (typeof syncData.imported === "number") {
        redirectUrl.searchParams.set("imported", String(syncData.imported));
    }

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set("smartthings_oauth_state", "", {
        path: "/api/auth/smartthings",
        maxAge: 0,
    });

    return response;
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function expiresAtFrom(expiresIn: unknown): string | undefined {
    const seconds = Number(expiresIn);
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
    return new Date(Date.now() + seconds * 1000).toISOString();
}

function publicOrigin(request: NextRequest, redirectUri: string): string {
    const configuredOrigin = stringValue(process.env.SMARTTHINGS_PUBLIC_ORIGIN).replace(/\/+$/, "");
    if (configuredOrigin) return configuredOrigin;

    const forwardedHost = firstForwardedHeader(request, "x-forwarded-host");
    if (forwardedHost) {
        const forwardedProto = firstForwardedHeader(request, "x-forwarded-proto") || "https";
        return `${forwardedProto}://${forwardedHost}`;
    }

    try {
        return new URL(redirectUri).origin;
    } catch {
        return request.nextUrl.origin;
    }
}

function firstForwardedHeader(request: NextRequest, key: string): string {
    return stringValue(request.headers.get(key)?.split(",")[0]);
}
