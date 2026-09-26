import 'dotenv/config';

const isTest = process.env.NODE_ENV === 'test';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`Missing required env var ${name} (see .env.example)`);
  return value;
}

export const config = {
  isTest,
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  databaseUrl: isTest ? required('TEST_DATABASE_URL') : required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  otp: { ttlMinutes: 10, maxAttempts: 5, resendCooldownSeconds: 30 },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'StockSense <no-reply@stocksense.local>',
  },
};

if (!isTest && config.jwtSecret.length < 32) {
  console.warn('[config] JWT_SECRET is shorter than 32 characters. Use a long random string.');
}
