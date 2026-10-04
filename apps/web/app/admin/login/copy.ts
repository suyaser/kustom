/** `/admin/login`'s words (M14.23 follow-up). [NEW COPY] unless noted. */

export const ADMIN_LOGIN_TITLE = 'Kustom admin';
export const ADMIN_LOGIN_LEAD = 'Sign in to run your group: members, Discord, hosts.';
export const ADMIN_LOGIN_SIGNED_IN = "You're signed in.";
export const OPEN_ADMIN_LABEL = 'Open admin';
export const ADMIN_LOGIN_DENIED = "This Discord account doesn't run a group here.";
export const ADMIN_LOGIN_DENIED_HELP =
  "If you should be an admin, ask your group's owner to make you one on the group's Members page. Not linked to a League account yet? Open your group's tonight page and tap your name next time you're in the lobby, or type a code into Kustom.";
export const ADMIN_LOGIN_ERROR = (reason: string): string => `Sign-in didn't work: ${reason}`;
export const ADMIN_LOGIN_PUBLIC = 'Everything else on Kustom is public and needs no account.';
export const PUBLIC_HOME_LABEL = 'Go to Kustom';
/** Design round 1 (N6): the denied state's sign-out, which comes back here to sign in again. [NEW COPY] */
export const USE_ANOTHER_ACCOUNT_LABEL = 'Use another Discord account';
