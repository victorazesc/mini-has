import { LoginForm } from "@/components/login-form";

type LoginPageProps = {
  searchParams: Promise<{ returnTo?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { returnTo } = await searchParams;
  return <LoginForm returnTo={returnTo} />;
}
