"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { HouseWifi, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ returnTo = "/" }: { returnTo?: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(form.get("email") || ""),
        password: String(form.get("password") || ""),
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(payload?.message || "Não foi possível entrar.");
      setIsSubmitting(false);
      return;
    }

    router.replace(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm shadow-xl">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <HouseWifi className="size-6" />
        </div>
        <div>
          <CardTitle className="text-2xl">Mini HAS</CardTitle>
          <CardDescription>Entre para controlar sua casa.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button className="w-full" type="submit" disabled={isSubmitting}>
            {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
            Entrar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
