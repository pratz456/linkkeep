import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import LinkedIn from "next-auth/providers/linkedin";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import * as schema from "@/db/schema";

export const linkedInConfigured =
  Boolean(process.env.AUTH_LINKEDIN_ID) &&
  Boolean(process.env.AUTH_LINKEDIN_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  providers: [
    ...(linkedInConfigured
      ? [
          LinkedIn({
            clientId: process.env.AUTH_LINKEDIN_ID!,
            clientSecret: process.env.AUTH_LINKEDIN_SECRET!,
            authorization: {
              params: {
                scope: "openid profile email",
              },
            },
          }),
        ]
      : [
          Credentials({
            id: "demo",
            name: "Demo",
            credentials: {},
            async authorize() {
              if (process.env.NODE_ENV === "production") return null;
              await ensureDb();

              const email = "demo@localhost.dev";
              const existing = await db
                .select()
                .from(schema.users)
                .where(eq(schema.users.email, email))
                .limit(1);

              if (existing[0]) {
                return {
                  id: existing[0].id,
                  name: existing[0].name,
                  email: existing[0].email,
                  image: existing[0].image,
                };
              }

              const id = crypto.randomUUID();
              await db.insert(schema.users).values({
                id,
                name: "Demo User",
                email,
                image: null,
              });

              return { id, name: "Demo User", email, image: null };
            },
          }),
        ]),
  ],
  // Credentials provider requires JWT sessions
  session: {
    strategy: linkedInConfigured ? "database" : "jwt",
  },
  pages: {
    signIn: "/",
    error: "/",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, user, token }) {
      if (session.user) {
        session.user.id = linkedInConfigured
          ? user.id
          : (token.sub as string);
      }
      return session;
    },
  },
  trustHost: true,
});
