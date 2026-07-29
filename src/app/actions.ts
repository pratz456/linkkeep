"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { linkedInConfigured, signIn, signOut } from "@/auth";

export async function signInWithLinkedIn() {
  if (!linkedInConfigured) {
    redirect("/?error=linkedin_not_configured");
  }
  try {
    await signIn("linkedin", { redirectTo: "/dashboard" });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

export async function signInDemo() {
  if (linkedInConfigured) {
    redirect("/?error=demo_disabled");
  }
  try {
    await signIn("demo", { redirectTo: "/dashboard" });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
