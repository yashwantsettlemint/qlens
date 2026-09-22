import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth";
import { verifyHS256 } from "@/server/jwt";

/** Lets the client restore {user, role, exp} from the httpOnly cookie on page load. */
const JWT_SECRET = process.env.HASURA_GRAPHQL_JWT_SECRET ?? "";

export async function GET() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ session: null });

  const claims = verifyHS256(token, JWT_SECRET);
  if (!claims) return NextResponse.json({ session: null });

  return NextResponse.json({ session: { user: claims.user, role: claims.role, exp: claims.exp * 1000 } });
}
