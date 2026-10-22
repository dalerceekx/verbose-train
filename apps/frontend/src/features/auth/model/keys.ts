export const authKeys = {
  me: ['auth', 'me'] as const,
  sessions: ['auth', 'sessions'] as const,
  methods: ['auth', 'methods'] as const,
  /** The sample farm's user while browsing without an account. */
  guest: ['auth', 'guest'] as const,
};
