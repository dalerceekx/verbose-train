import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { GoogleSignIn } from '@/features/auth/components/GoogleSignIn';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { useAuthMethods } from '@/features/auth/hooks/useAuthFlows';
import { useSessionStore, type LoginNotice } from '@/features/auth/model/session.store';
import { Alert } from '@/shared/ui';

const NOTICES: Record<Exclude<LoginNotice, null>, { tone: 'info' | 'success'; text: string }> = {
  expired: { tone: 'info', text: 'Sessiya muddati tugadi. Iltimos, qaytadan kiring.' },
  'logged-out-elsewhere': { tone: 'info', text: 'Boshqa oynada tizimdan chiqildi.' },
  'password-reset': { tone: 'success', text: 'Parol yangilandi. Yangi parol bilan kiring.' },
  'phone-verified': { tone: 'success', text: 'Telefon raqami tasdiqlandi. Endi tizimga kirishingiz mumkin.' },
};

export default function LoginPage() {
  const location = useLocation();
  const phone = (location.state as { phone?: string } | null)?.phone ?? '';
  // A notice is shown once: copy it on mount, then clear it from the store.
  // The ended session has been dealt with here too: browsing on lands in
  // guest mode instead of back on this page.
  const [notice] = useState<LoginNotice>(() => useSessionStore.getState().notice);
  useEffect(() => {
    useSessionStore.setState({ notice: null, endReason: null });
  }, []);

  const noticeContent = notice ? NOTICES[notice] : null;
  const methods = useAuthMethods();
  // Until the server answers (or if it cannot), keep the SMS links visible:
  // a disabled flow still explains itself with SMS_DISABLED.
  const sms = methods.data?.sms ?? true;
  const google = Boolean(methods.data?.google);

  return (
    <AuthLayout
      title="Xush kelibsiz!"
      description="Fermangizni boshqarish uchun tizimga kiring."
      footer={
        sms ? (
          <>
            Hisobingiz yo‘qmi?{' '}
            <Link to="/register" className="font-medium text-warning underline-offset-4 hover:underline">
              Ro‘yxatdan o‘ting
            </Link>
          </>
        ) : google ? (
          'Hisobingiz yo‘qmi? Google bilan birinchi marta kirganingizda hisob avtomatik ochiladi.'
        ) : (
          'Hisob ochish uchun administratorga murojaat qiling.'
        )
      }
    >
      {noticeContent ? (
        <Alert tone={noticeContent.tone} className="mb-5">
          {noticeContent.text}
        </Alert>
      ) : null}
      <GoogleSignIn />
      {google ? (
        <div className="my-5 flex items-center gap-3 text-[13px] text-ink-secondary" role="separator">
          <span className="h-px flex-1 bg-line" />
          yoki telefon raqami bilan
          <span className="h-px flex-1 bg-line" />
        </div>
      ) : null}
      <LoginForm defaultPhone={phone} passwordReset={sms} />
    </AuthLayout>
  );
}
