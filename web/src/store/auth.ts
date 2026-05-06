"use client";

export type AuthRole = "admin" | "user";

export type StoredAuthSession = {
  key: string;
  role: AuthRole;
  subjectId: string;
  name: string;
};

export const AUTH_KEY_STORAGE_KEY = "chatgpt2api_auth_key";
export const AUTH_SESSION_STORAGE_KEY = "chatgpt2api_auth_session";

function getBrowserStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeSession(value: unknown, fallbackKey = ""): StoredAuthSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StoredAuthSession>;
  const key = String(candidate.key || fallbackKey || "").trim();
  const role = candidate.role === "admin" || candidate.role === "user" ? candidate.role : null;
  if (!key || !role) {
    return null;
  }

  return {
    key,
    role,
    subjectId: String(candidate.subjectId || "").trim(),
    name: String(candidate.name || "").trim(),
  };
}

export function getDefaultRouteForRole(role: AuthRole) {
  return role === "admin" ? "/accounts" : "/image";
}

export async function getStoredAuthKey() {
  const storage = getBrowserStorage();
  return String(storage?.getItem(AUTH_KEY_STORAGE_KEY) || "").trim();
}

export async function getStoredAuthSession() {
  const storage = getBrowserStorage();
  if (!storage) {
    return null;
  }

  const storedKey = storage.getItem(AUTH_KEY_STORAGE_KEY);
  let storedSession: StoredAuthSession | null = null;

  try {
    const rawStoredSession = storage.getItem(AUTH_SESSION_STORAGE_KEY);
    storedSession = rawStoredSession ? (JSON.parse(rawStoredSession) as StoredAuthSession) : null;
  } catch {
    storedSession = null;
  }

  const normalizedSession = normalizeSession(storedSession, String(storedKey || ""));
  if (normalizedSession) {
    if (normalizedSession.key !== String(storedKey || "").trim()) {
      storage.setItem(AUTH_KEY_STORAGE_KEY, normalizedSession.key);
    }
    return normalizedSession;
  }

  if (String(storedKey || "").trim()) {
    await clearStoredAuthSession();
  }
  return null;
}

export async function setStoredAuthSession(session: StoredAuthSession) {
  const normalizedSession = normalizeSession(session);
  if (!normalizedSession) {
    await clearStoredAuthSession();
    return;
  }

  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }

  storage.setItem(AUTH_KEY_STORAGE_KEY, normalizedSession.key);
  storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(normalizedSession));
}

export async function setStoredAuthKey(authKey: string) {
  const normalizedAuthKey = String(authKey || "").trim();
  if (!normalizedAuthKey) {
    await clearStoredAuthSession();
    return;
  }
  const storage = getBrowserStorage();
  storage?.setItem(AUTH_KEY_STORAGE_KEY, normalizedAuthKey);
}

export async function clearStoredAuthSession() {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }
  storage.removeItem(AUTH_KEY_STORAGE_KEY);
  storage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

export async function clearStoredAuthKey() {
  await clearStoredAuthSession();
}
