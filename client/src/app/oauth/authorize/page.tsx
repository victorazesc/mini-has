import { cookies } from "next/headers";
import { HouseWifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type OAuthAuthorizePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type AuthorizationDetails = {
  client: { clientId: string; name: string };
  redirectUri: string;
  scopes: string[];
  state?: string;
  user: { email: string };
};

const SCOPE_LABELS: Record<string, string> = {
  "devices:read": "Consultar seus dispositivos e estados",
  "devices:control": "Controlar seus dispositivos",
  "scenes:read": "Consultar suas cenas",
  "scenes:run": "Executar suas cenas",
  "mcp:connect": "Conectar ferramentas de inteligência artificial",
};

export default async function OAuthAuthorizePage({
  searchParams,
}: OAuthAuthorizePageProps) {
  const serverUrl = process.env.SERVER_URL;
  const rawParams = await searchParams;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === "string") params.set(key, value);
  }

  let details: AuthorizationDetails | null = null;
  let error = "";

  if (!serverUrl) {
    error = "Servidor não configurado.";
  } else {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore
      .getAll()
      .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
      .join("; ");

    try {
      const response = await fetch(`${serverUrl}/oauth/authorize?${params}`, {
        headers: { Cookie: cookieHeader },
        cache: "no-store",
      });
      if (response.ok) {
        details = (await response.json()) as AuthorizationDetails;
      } else {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        error = payload?.message || "Solicitação OAuth inválida.";
      }
    } catch {
      error = "Mini HAS indisponível.";
    }
  }

  return (
    <Card className="w-full max-w-lg shadow-xl">
      <CardHeader className="space-y-3">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <HouseWifi className="size-5" />
        </div>
        <div>
          <CardTitle>Autorizar acesso ao Mini HAS</CardTitle>
          <CardDescription>
            {details
              ? `${details.client.name} quer acessar a conta ${details.user.email}.`
              : "Não foi possível validar esta solicitação."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {details ? (
          <form action="/api/oauth/authorize" method="post" className="space-y-5">
            {Array.from(params.entries()).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <div className="rounded-xl border bg-muted/40 p-4">
              <p className="mb-2 text-sm font-medium">Permissões solicitadas</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {details.scopes.map((scope) => (
                  <li key={scope}>• {SCOPE_LABELS[scope] || scope}</li>
                ))}
              </ul>
            </div>
            <div className="flex gap-3">
              <Button className="flex-1" type="submit" name="approved" value="true">
                Autorizar
              </Button>
              <Button
                className="flex-1"
                type="submit"
                name="approved"
                value="false"
                variant="outline"
              >
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
