// Deploy path: supabase/functions/send-notification/index.ts
// Deploy with:  supabase functions deploy send-notification
//
// Required secrets (set once, before deploying):
//   supabase secrets set VAPID_PUBLIC_KEY=your_public_key
//   supabase secrets set VAPID_PRIVATE_KEY=your_private_key
//   supabase secrets set VAPID_SUBJECT=mailto:you@example.com
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already available
// automatically inside every Edge Function — no need to set those.)
//
// This function is called from the app after a significant event (a new
// notice, a payment recorded/cleared, a member removed, etc.). It looks up
// every subscribed device and pushes the notification to each one. Any
// subscription the push service reports as gone (410/404 — the user
// uninstalled, cleared site data, etc.) gets deleted so the table doesn't
// accumulate dead rows.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { title, body, url } = await req.json();
    if (!title) {
      return new Response(JSON.stringify({ error: "title is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
    if (error) throw error;

    const payload = JSON.stringify({ title, body: body || "", url: url || "/" });
    const staleEndpoints: string[] = [];

    await Promise.all(
      (subs || []).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            staleEndpoints.push(sub.endpoint);
          } else {
            console.error("push failed for", sub.endpoint, err?.message || err);
          }
        }
      })
    );

    if (staleEndpoints.length > 0) {
      await supabase.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
    }

    return new Response(JSON.stringify({ sent: (subs || []).length - staleEndpoints.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
