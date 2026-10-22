-- Google sign-in (SMS registration stays off until the SMS provider is
-- approved): an account may have no phone, an email verified by Google and a
-- linked Google account id (the ID token `sub`).
--
-- Sections after the Prisma-generated part (CHECK constraints) cannot be
-- expressed in schema.prisma. Prisma ignores these objects when diffing, so
-- later migrations will not drop them.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMP(3),
ADD COLUMN     "google_sub" VARCHAR(255),
ALTER COLUMN "phone" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

-- =========================================================================
-- users
-- =========================================================================

ALTER TABLE "users"
  DROP CONSTRAINT "users_active_requires_verified_phone_chk",
  -- An account is never fully active before its phone or email is verified.
  ADD CONSTRAINT "users_active_requires_verified_contact_chk" CHECK (
    "status" <> 'ACTIVE' OR "phone_verified_at" IS NOT NULL OR "email_verified_at" IS NOT NULL
  ),
  ADD CONSTRAINT "users_contact_chk" CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL),
  -- A linked Google account always comes with the email Google verified.
  ADD CONSTRAINT "users_google_sub_chk" CHECK (
    "google_sub" IS NULL OR (
      char_length(btrim("google_sub")) > 0
      AND "email" IS NOT NULL
      AND "email_verified_at" IS NOT NULL
    )
  );
