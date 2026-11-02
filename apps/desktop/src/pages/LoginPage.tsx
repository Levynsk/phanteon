import { useState } from 'react';
import { useAuthStore } from '../app/stores/auth';
import { AuthLink, AuthLayout, FormError } from '../features/auth/AuthLayout';
import { Button } from '../components/ui/Button';
import { AuthField } from '../components/ui/FormPrimitives';

export function LoginPage() {
  const login = useAuthStore((state) => state.login);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || !identifier.trim() || !password) return;
    setSubmitting(true);
    await login(identifier.trim(), password);
    setSubmitting(false);
  };

  return (
    <AuthLayout
      title="Bem-vindo de volta"
      subtitle="Entre com a sua conta para continuar de onde parou."
      footer={
        <>
          Ainda não tem uma conta? <AuthLink to="/register">Criar conta</AuthLink>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        <FormError>{error}</FormError>
        <AuthField
          label="E-mail ou usuário"
          autoComplete="username"
          autoFocus
          placeholder="voce@exemplo.com"
          value={identifier}
          onChange={(event) => {
            clearError();
            setIdentifier(event.target.value);
          }}
        />
        <AuthField
          label="Senha"
          type="password"
          autoComplete="current-password"
          placeholder="Sua senha"
          value={password}
          onChange={(event) => {
            clearError();
            setPassword(event.target.value);
          }}
        />
        <Button type="submit" variant="primary" size="lg" block loading={submitting} className="mt-1 rounded-md">
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
