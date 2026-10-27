import { z } from "zod";
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "日付が不正です");
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const periodSchema = z.number().int().min(1).max(6);
export const patternSchema = z.enum(["default", "temporary", "temporary2"]);
