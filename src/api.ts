import type { Identity } from "../shared/domain";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
let identity: Identity | null = null;
export function setIdentity(value: Identity | null) {
  identity = value;
}
export async function api<T>(path: string, data?: unknown): Promise<T> {
  const r = await fetch(path, {
    credentials: "same-origin",
    headers: data
      ? {
          "Content-Type": "application/json",
          "X-CSRF-Token": identity?.csrf ?? "",
        }
      : {},
    ...(data ? { method: "POST", body: JSON.stringify(data) } : {}),
  });
  const result = await r.json();
  if (!r.ok)
    throw new ApiError(
      typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
        ? result.error
        : "読み込みに失敗しました",
      r.status,
    );
  return result as T;
}
