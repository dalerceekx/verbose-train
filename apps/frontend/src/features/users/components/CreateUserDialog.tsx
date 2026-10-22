import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { assignableRoles, ROLE_LABELS } from '@/features/auth/lib/permissions';
import { errorMessage, validationFieldErrors } from '@/shared/api/errors';
import { normalizeUzPhone } from '@/shared/lib/phone';
import { newPasswordSchema, requiredText } from '@/shared/lib/validation';
import { USER_ROLES, type UserRole } from '@/shared/types/api';
import { Alert, Button, Field, FormError, Input, Modal, PasswordInput, Select, toast } from '@/shared/ui';
import type { CreateUserInput } from '../api/users.api';
import { useCreateUser } from '../model/users.queries';

// Same shape the backend (and the users_email_normalized_chk constraint) accepts.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const schema = z
  .object({
    fullName: requiredText('Ism va familiyani kiriting', 100).refine((value) => value.length >= 2, 'Kamida 2 ta belgi'),
    email: z
      .string()
      .trim()
      .max(254, 'Ko‘pi bilan 254 ta belgi')
      .refine((value) => value === '' || EMAIL.test(value), 'Email manzili noto‘g‘ri'),
    phone: z
      .string()
      .trim()
      .refine((value) => value === '' || normalizeUzPhone(value) !== null, 'Raqamni +998 90 123 45 67 ko‘rinishida kiriting'),
    role: z.enum(USER_ROLES),
    password: z.string(),
  })
  .superRefine((values, ctx) => {
    if (!values.email && !values.phone) {
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'Google email yoki telefon raqamini kiriting' });
    }
    // A phone account signs in with phone + password; Google needs none.
    if (values.phone || values.password) {
      const password = newPasswordSchema.safeParse(values.password);
      if (!password.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['password'],
          message: values.password
            ? (password.error.issues[0]?.message ?? 'Parol talablarga mos emas')
            : 'Telefon bilan kirish uchun parol kiriting',
        });
      }
    }
  });
type Values = z.infer<typeof schema>;

/** Empty optional fields are left out: the API wants absent, not "". */
function toInput(values: Values): CreateUserInput {
  return {
    fullName: values.fullName,
    role: values.role,
    ...(values.email ? { email: values.email.toLowerCase() } : {}),
    ...(values.phone ? { phone: normalizeUzPhone(values.phone) ?? values.phone } : {}),
    ...(values.password ? { password: values.password } : {}),
  };
}

/**
 * Staff onboarding: the backend creates an ACTIVE account. With a Google
 * email the user signs in with that Google account; with a phone, with the
 * phone and the initial password.
 */
export function CreateUserDialog({
  open,
  onClose,
  actorRole,
  actorIsDemo = false,
}: {
  open: boolean;
  onClose: () => void;
  actorRole: UserRole;
  actorIsDemo?: boolean;
}) {
  const create = useCreateUser();
  const roles = assignableRoles(actorRole);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      role: roles.includes('VET') ? 'VET' : (roles[0] ?? 'FARMER'),
      password: '',
    },
  });

  useEffect(() => {
    if (open) {
      reset();
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = handleSubmit((values) => {
    if (create.isPending) return;
    create.mutate(toInput(values), {
      onSuccess: (user) => {
        toast.success(`${user.fullName} hisobi yaratildi`);
        onClose();
      },
      onError: (error) => {
        const fieldErrors = validationFieldErrors(error, ['fullName', 'email', 'phone', 'role', 'password'] as const);
        for (const [field, message] of Object.entries(fieldErrors)) setError(field as keyof Values, { message });
      },
    });
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yangi foydalanuvchi"
      description="Xodim yoki fermer hisobini yaratish"
      dismissible={!create.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Bekor qilish
          </Button>
          <Button type="submit" form="create-user-form" loading={create.isPending} disabled={actorIsDemo}>
            Yaratish
          </Button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {actorIsDemo ? (
          <Alert tone="warning" title="Demo akkaunt">
            Demo akkaunt orqali haqiqiy foydalanuvchi qo‘shib bo‘lmaydi. Haqiqiy SUPER_ADMIN hisobi bilan kiring.
          </Alert>
        ) : null}
        <Field label="Ism va familiya" error={errors.fullName?.message} required>
          <Input data-autofocus autoComplete="off" {...register('fullName')} />
        </Field>
        <Field
          label="Google email"
          error={errors.email?.message}
          hint="Foydalanuvchi shu Google akkaunti bilan “Google bilan kirish” tugmasi orqali kiradi."
        >
          <Input type="email" inputMode="email" autoComplete="off" placeholder="fermer@gmail.com" {...register('email')} />
        </Field>
        <Field label="Telefon raqami" error={errors.phone?.message} hint="Ixtiyoriy: telefon va parol bilan ham kirishi uchun.">
          <Input type="tel" inputMode="tel" autoComplete="off" placeholder="+998 90 123 45 67" {...register('phone')} />
        </Field>
        <Field
          label="Rol"
          error={errors.role?.message}
          required
          hint={actorRole === 'ADMIN' ? 'Administrator faqat xodim va fermer rollarini bera oladi' : undefined}
        >
          <Select {...register('role')}>
            {roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Boshlang‘ich parol"
          error={errors.password?.message}
          hint="Faqat telefon raqami kiritilsa kerak: kamida 8 ta belgi, harf va raqam. Foydalanuvchiga xavfsiz yo‘l bilan yetkazing."
        >
          <PasswordInput autoComplete="new-password" {...register('password')} />
        </Field>
        <Alert tone="info">Administrator rollari birinchi kirishda ikki bosqichli himoyani (TOTP) majburiy sozlaydi.</Alert>
        <FormError message={create.error ? errorMessage(create.error) : null} />
      </form>
    </Modal>
  );
}
