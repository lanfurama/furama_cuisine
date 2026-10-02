import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { admin as adminPlugin } from 'better-auth/plugins/admin';
import type { Pool } from 'pg';
import { RESET_TOKEN_SECONDS } from './lifetimes';
import { ac, roles } from './permissions';
import { decideSignup } from './signup-gate';

/*
 * The one Better Auth configuration, built from injected parts so the app
 * (lib/server/auth/auth.ts), the schema CLI (scripts/auth-cli.config.ts), the
 * bootstrap script and the integration tests share it. The admin plugin's
 * schema merge mutates module state, so there must never be a second config.
 * No `server-only` here: the CLI and the script cannot load a module that
 * imports it.
 */

export const ADMIN_ENDPOINT_BLOCKED = 'ADMIN_ENDPOINT_BLOCKED';
export const INVITATION_REQUIRED = 'INVITATION_REQUIRED';

const DAY = 24 * 60 * 60;

export type ResetEmail = { user: { email: string; name: string }; token: string };

export type AuthDeps = {
  pool: Pool;
  /** BETTER_AUTH_SECRET; Better Auth refuses to start in production without one. */
  secret: string | undefined;
  /** BETTER_AUTH_URL, e.g. http://localhost:3200: the origin of the app and of emailed links. */
  baseURL: string | undefined;
  bootstrapAdminEmail: string | undefined;
  /** Sends the reset email; builds its own /admin/reset-password link from `token`. */
  sendResetPassword: (email: ResetEmail) => Promise<unknown>;
  /** Defaults to Better Auth's own rule: on in production only. */
  rateLimitEnabled?: boolean;
  /**
   * Runs Better Auth's background work (the reset email, the rate-limit
   * cleanup) after the response; the app passes Next's after(). Without it
   * Better Auth awaits the send (better-auth/dist/context/create-context.mjs:
   * 215-221), so a real staff address would answer slower than an unknown one.
   */
  backgroundTask?: (task: Promise<unknown>) => void;
};

/** An error's `code` (EmailSendError has one), never its message: messages may carry addresses. */
function codeOf(err: unknown): string {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : 'unknown';
}

export function createAuth(deps: AuthDeps) {
  return betterAuth({
    appName: 'Furama Cuisine',
    secret: deps.secret,
    baseURL: deps.baseURL,
    database: deps.pool,
    telemetry: { enabled: false },

    // Spec §5.2: staff_* tables via modelName; snake_case columns like the rest of the schema.
    user: {
      modelName: 'staff_user',
      fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    session: {
      modelName: 'staff_session',
      expiresIn: 7 * DAY,
      updateAge: DAY,
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    account: {
      modelName: 'staff_account',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'staff_verification',
      // Reset tokens are bearer secrets: keep only SHA-256(identifier), as
      // staff_invitation keeps only token_hash. Lookups hash the same way.
      storeIdentifier: 'hashed',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },

    // Counted per IP and path by the HTTP router only; auth.api.* calls are never limited.
    rateLimit: {
      enabled: deps.rateLimitEnabled,
      storage: 'database',
      modelName: 'auth_rate_limit',
      fields: { lastRequest: 'last_request' },
    },

    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS, // the reset email states the same lifetime
      // Better Auth answers 200 for any email; with deps.backgroundTask this
      // runs after that answer (runInBackgroundOrAwait), so a staff address
      // answers as fast as an unknown one. A throw here must neither change the
      // answer nor reveal whether the account exists. Its `url` (a redirect hop
      // through /api/auth/reset-password/:token) is ignored; the email links to
      // our page.
      sendResetPassword: async ({ user, token }) => {
        try {
          await deps.sendResetPassword({ user: { email: user.email, name: user.name }, token });
        } catch (err) {
          console.error('[auth] reset email failed', { code: codeOf(err) });
        }
      },
    },

    databaseHooks: {
      user: {
        create: {
          // Runs after the admin plugin's own hook, so it has the last word on `role`.
          before: async (user) => {
            const decision = await decideSignup(deps.pool, user.email, deps.bootstrapAdminEmail);
            if (!decision.ok) {
              throw new APIError('FORBIDDEN', {
                code: INVITATION_REQUIRED,
                message: 'This email has no open invitation.',
              });
            }
            return { data: { ...user, role: decision.role } };
          },
        },
      },
    },

    advanced: {
      backgroundTasks: deps.backgroundTask ? { handler: deps.backgroundTask } : undefined,
    },

    hooks: {
      // Spec §7.1: no browser may reach the admin plugin's endpoints. The HTTP
      // router passes `request`; a server-side auth.api.* call does not.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.request && ctx.path.startsWith('/admin/')) {
          throw new APIError('FORBIDDEN', {
            code: ADMIN_ENDPOINT_BLOCKED,
            message: 'Admin endpoints are server-only.',
          });
        }
      }),
    },

    plugins: [
      adminPlugin({
        ac,
        roles,
        defaultRole: 'editor',
        adminRoles: ['admin'],
        schema: {
          user: { fields: { banReason: 'ban_reason', banExpires: 'ban_expires' } },
          session: { fields: { impersonatedBy: 'impersonated_by' } },
        },
      }),
      nextCookies(), // must stay last
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
