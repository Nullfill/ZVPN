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
// Endpoints observed in the installed Antigravity app, plus sign-in helpers.
// Keep this separate from Gemini defaults so custom policies are never expanded silently.
export const ANTIGRAVITY_DOMAINS = [
  'antigravity.google', 'antigravity.google.com',
  'antigravity-unleash.goog',
  'daily-cloudcode-pa.googleapis.com', 'cloudcode-pa.googleapis.com',
  'generativelanguage.googleapis.com', 'cloudaicompanion.googleapis.com',
  'jetski-webchannel.googleapis.com',
  'accounts.google.com', 'www.google.com', 'recaptcha.net',
  'googleapis.com', 'googleusercontent.com', 'gstatic.com',
];
export const WARP_DEFAULTS = {
  enabled: false, scope: 'all', userIds: [], domains: GEMINI_DOMAINS,
  excludedDomains: [], failureMode: 'block', disableQuic: true,
};
