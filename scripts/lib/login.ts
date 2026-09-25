// Customer Login API: a signed HS256 JWT exchanged at /login/token/{jwt}. The link is valid for about 30s.
import { createHmac, randomUUID } from 'node:crypto';
import { credentials, storefrontUrl } from './env.ts';

export async function loginUrl(customerId: number, redirectTo = '/checkout'): Promise<string> {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    iss: credentials.required('client_id'),
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
    operation: 'customer_login',
    store_hash: credentials.required('store_hash'),
    customer_id: customerId,
    channel_id: 1,
    redirect_to: redirectTo,
  });
  const signature = createHmac('sha256', credentials.required('client_secret')).update(`${header}.${payload}`).digest('base64url');
  return `${await storefrontUrl()}/login/token/${header}.${payload}.${signature}`;
}
