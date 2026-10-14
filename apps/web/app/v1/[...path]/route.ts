import { api } from '@/lib/api';

// Every /v1/* call goes through the framework-free API router (auth, RLS context, problem+json).
export const dynamic = 'force-dynamic';
const handler = (req: Request) => api()(req);
export { handler as GET, handler as POST, handler as DELETE };
