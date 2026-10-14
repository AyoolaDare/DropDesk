import { NextResponse, type NextRequest } from 'next/server';

// Cheap gate only: real session validation happens server-side on every API call.
export function middleware(req: NextRequest) {
  if (!req.cookies.get('dd_session')) return NextResponse.redirect(new URL('/login', req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/((?!login|v1|_next|favicon.ico).*)'] };
