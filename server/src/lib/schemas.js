import { z } from 'zod';

// Shared building blocks for request validation (field-level messages go straight to the UI)
export const id = z.coerce.number({ invalid_type_error: 'Must be a number' }).int().positive('Invalid id');
export const optionalId = z.preprocess((v) => (v === '' || v === null ? undefined : v), id.optional());
export const qty = z.coerce
  .number({ invalid_type_error: 'Enter a number' })
  .finite('Enter a number')
  .nonnegative('Quantity cannot be negative')
  .max(1e9, 'Quantity is too large')
  .transform((v) => Math.round(v * 1000) / 1000); // 3 decimals, matches NUMERIC(14,3)
export const text = (min, max, label) =>
  z.string({ required_error: `${label} is required` }).trim().min(min, `${label} must be at least ${min} characters`).max(max, `${label} is too long`);
export const optionalText = (max) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
export const email = z.string({ required_error: 'Email is required' }).trim().toLowerCase().email('Enter a valid email address');
export const password = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[a-z]/, 'Add a lowercase letter')
  .regex(/[A-Z]/, 'Add an uppercase letter')
  .regex(/[0-9]/, 'Add a number')
  .regex(/[^A-Za-z0-9]/, 'Add a special character');
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
export const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};
