import { useState } from 'react';
import { USERNAME_PATTERN } from '@phanteon/shared';
import { useAuthStore } from '../app/stores/auth';
import { AuthLink, AuthLayout, FormError } from '../features/auth/AuthLayout';
import { Button } from '../components/ui/Button';
import { AuthField } from '../components/ui/FormPrimitives';

const EMPTY_FORM = { displayName: '', username: '', email: '', password: '' };

export function RegisterPage() {
  const register = useAuthStore((state) => state.register);
  const storeError = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    clearError();
    setLocalError(null);
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const username = form.username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      setLocalError('Use de 3 a 24 caracteres: minúsculas, números, "." ou "_".');
      return;
    }
    if (form.password.length < 8) {
      setLocalError('A senha precisa ter ao menos 8 caracteres.');
      return;
    }
    setSubmitting(true);
    await register({
      username,
      displayName: form.displayName.trim() || undefined,
      email: form.email.trim(),
      password: form.password,
    });
    setSubmitting(false);
  };

  return (
    <AuthLayout
      title="Crie sua conta"
      subtitle="Leva menos de um minuto para começar a conversar."
      footer={
        <>
          Já tem uma conta? <AuthLink to="/login">Entrar</AuthLink>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <FormError>{localError ?? storeError}</FormError>
        <AuthField label="Nome de exibição" placeholder="Como as pessoas vão te ver" value={form.displayName} onChange={update('displayName')} />
        <AuthField label="Nome de usuário" placeholder="ex.: joao_silva" required autoComplete="username" value={form.username} onChange={update('username')} />
        <AuthField label="E-mail" type="email" required autoComplete="email" placeholder="voce@exemplo.com" value={form.email} onChange={update('email')} />
        <AuthField
          label="Senha"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Mínimo de 8 caracteres"
          hint="Pelo menos 8 caracteres."
          value={form.password}
          onChange={update('password')}
        />
        <Button type="submit" variant="primary" size="lg" block loading={submitting} className="mt-1 rounded-md">
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  );
}
