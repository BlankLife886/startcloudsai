// Referrals remain unpublished until explicitly enabled for a release.
// The server independently enforces registration and reward availability.
export const REFERRALS_ENABLED = import.meta.env.VITE_REFERRALS_ENABLED === "true";
