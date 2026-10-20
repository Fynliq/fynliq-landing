import { observe } from '../../server/observability.js';
import { createAccountHandler } from '../../server/account-login.js';
export default observe('/api/auth/logout', createAccountHandler('logout'));
