// Shared Google infrastructure is needed by Gemini sign-in and mobile clients.
export const GEMINI_DOMAINS = [
  'gemini.google.com', 'gemini.google', 'bard.google.com', 'aistudio.google.com',
  'makersuite.google.com', 'ai.google.dev', 'alkalicore-pa.clients6.google.com',
  'alkalimakersuite-pa.clients6.google.com', 'webchannel-alkalimakersuite-pa.clients6.google.com',
  'geminiweb-pa.clients.google.com', 'geminiweb-pa.clients6.google.com',
  'accounts.google.com', 'apis.google.com', 'ogs.google.com',
  'googleapis.com', 'googleusercontent.com', 'gstatic.com',
  'www.google.com', 'recaptcha.net',
];
export const WARP_DEFAULTS = {
  enabled: false, scope: 'all', userIds: [], domains: GEMINI_DOMAINS,
  excludedDomains: [], failureMode: 'block', disableQuic: true,
};
