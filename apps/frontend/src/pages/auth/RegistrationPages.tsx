import { Link, Navigate, useLocation } from 'react-router';
import { useState, type ReactNode } from 'react';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { DevSmsInboxSlot } from '@/features/auth/components/DevOnly';
import { GoogleSignIn } from '@/features/auth/components/GoogleSignIn';
import { ForgotPasswordForm, ResetPasswordForm } from '@/features/auth/components/PasswordRecoveryForms';
import { RegisterForm, type VerificationState } from '@/features/auth/components/RegisterForm';
import { VerifyPhoneForm } from '@/features/auth/components/VerifyPhoneForm';
import { useAuthMethods } from '@/features/auth/hooks/useAuthFlows';
import { formatPhone } from '@/shared/lib/phone';
import { Alert, Skeleton } from '@/shared/ui';

const LOGIN_LINK = (
  <>
    Hisobingiz bormi?{' '}
    <Link to="/login" className="font-medium text-warning underline-offset-4 hover:underline">
      Kirish
    </Link>
  </>
);

function useVerificationState(): VerificationState | null {
  const state = useLocation().state as Partial<VerificationState> | null;
  const [openedAt] = useState(Date.now);
  return state?.verificationId && state.phone
    ? {
        verificationId: state.verificationId,
        phone: state.phone,
        expiresIn: state.expiresIn ?? 0,
        resendAfter: state.resendAfter ?? 60,
        receivedAt: state.receivedAt ?? openedAt,
      }
    : null;
}

/**
 * The SMS flow's form, or — while the server has SMS off — Google sign-in
 * with an explanation. Unknown (loading failed): the form, which then shows
 * the server's own answer.
 */
function SmsFlow({ form, unavailable }: { form: ReactNode; unavailable: string }) {
  const methods = useAuthMethods();
  if (methods.isPending) return <Skeleton className="h-48" />;
  if (methods.data?.sms !== false) return form;
  const google = Boolean(methods.data.google);
  return (
    <div className="flex flex-col gap-5">
      <Alert tone="info">
        {unavailable} {google ? 'Google akkauntingiz bilan kiring.' : 'Administratorga murojaat qiling.'}
      </Alert>
      <GoogleSignIn text="signup_with" />
    </div>
  );
}

export function RegisterPage() {
  return (
    <AuthLayout title="Ro‘yxatdan o‘tish" description="Fermer hisobini yarating. Bu bir daqiqa vaqt oladi." footer={LOGIN_LINK}>
      <SmsFlow
        form={<RegisterForm />}
        unavailable="SMS orqali ro‘yxatdan o‘tish vaqtincha o‘chirilgan — birinchi marta kirganingizda hisob avtomatik ochiladi."
      />
    </AuthLayout>
  );
}

export function VerifyPhonePage() {
  const verification = useVerificationState();
  if (!verification) return <Navigate to="/register" replace />;
  return (
    <AuthLayout
      title="Telefonni tasdiqlang"
      description={`So‘rov qabul qilindi. Raqam mos bo‘lsa, ${formatPhone(verification.phone)} raqamiga 6 xonali kod SMS orqali yuboriladi.`}
      footer={LOGIN_LINK}
    >
      <div className="flex flex-col gap-5">
        <VerifyPhoneForm verification={verification} />
        <DevSmsInboxSlot />
      </div>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Parolni tiklash"
      description="Telefon raqamingizni kiriting — SMS orqali tasdiqlash kodi yuboramiz."
      footer={LOGIN_LINK}
    >
      <SmsFlow form={<ForgotPasswordForm />} unavailable="SMS orqali parolni tiklash vaqtincha o‘chirilgan." />
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const verification = useVerificationState();
  if (!verification) return <Navigate to="/forgot-password" replace />;
  return (
    <AuthLayout
      title="Yangi parol"
      description={`Agar hisob mavjud bo‘lsa, ${formatPhone(verification.phone)} raqamiga kod yuboriladi. Parol yangilangach, barcha qurilmalardan chiqiladi.`}
      footer={LOGIN_LINK}
    >
      <div className="flex flex-col gap-5">
        <ResetPasswordForm verification={verification} />
        <DevSmsInboxSlot />
      </div>
    </AuthLayout>
  );
}
