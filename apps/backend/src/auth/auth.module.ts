import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { SmsModule } from '../sms/sms.module.js';
import { AuthCookies } from './auth-cookies.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { DeferredWork } from './deferred-work.js';
import { GoogleIdTokenVerifier } from './google/google-id-token.verifier.js';
import { GoogleLoginService } from './google/google-login.service.js';
import { LoginService } from './login.service.js';
import { MfaService } from './mfa/mfa.service.js';
import { OtpService } from './otp.service.js';
import { OtpStore } from './otp.store.js';

// Session, token, password, rate-limit, encryption and audit services come
// from the global SecurityModule/AuditModule of the platform layer.
@Module({
  imports: [SmsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginService,
    GoogleLoginService,
    {
      provide: GoogleIdTokenVerifier,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new GoogleIdTokenVerifier(
          config.get('GOOGLE_CLIENT_ID', { infer: true }),
        ),
    },
    MfaService,
    OtpService,
    OtpStore,
    AuthCookies,
    DeferredWork,
  ],
})
export class AuthModule {}
