// npm run login-url -- [customerId=1] [redirectTo=/checkout]
// Prints a one-time storefront sign-in URL for a test shopper (Customer Login API). It expires in about 30s.
//   open "$(npm run -s login-url -- 1)"
import { loginUrl } from './lib/login.ts';

const [customerId = '1', redirectTo = '/checkout'] = process.argv.slice(2);
console.log(await loginUrl(Number(customerId), redirectTo));
