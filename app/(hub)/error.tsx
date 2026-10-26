"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel p-10">
      <h1>We could not load this view</h1>
      <p className="text-muted-foreground my-5">
        Check your connection and database setup, then try again. If this
        continues, contact your administrator.
      </p>
      <Button onClick={reset}>Try again</Button>
    </section>
  );
}
