/** sessionStorage key — same-tab revisits skip the Privacy Brief after first acknowledgment */
export const PRIVACY_BRIEF_SESSION_KEY = "recast-privacy-brief-ack-v1";

export function hasPrivacyBriefAcknowledgment(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(PRIVACY_BRIEF_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPrivacyBriefAcknowledgment(): void {
  try {
    sessionStorage.setItem(PRIVACY_BRIEF_SESSION_KEY, "1");
  } catch {
    /* ignore quota / private mode */
  }
}
