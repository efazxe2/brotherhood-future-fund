// This is a vite-plugin-pwa "injectManifest" SOURCE file — NOT a plain
// static file to drop in public/. Save it as src/sw.js (or wherever your
// vite.config.js's VitePWA({ srcDir: ... }) points) and switch the plugin
// to strategies: "injectManifest" — see the accompanying notes on exactly
// what to change in vite.config.js. The precacheAndRoute line below is
// required boilerplate: it's how vite-plugin-pwa injects the list of files
// to cache for offline use at build time. Everything below that is the
// actual push-notification handling.

import { precacheAndRoute } from "workbox-precaching";

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("push", (event) => {
  let data = { title: "Brotherhood Future Fund", body: "" };
  try {
    data = event.data.json();
  } catch (e) {
    data.body = event.data ? event.data.text() : "";
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Brotherhood Future Fund", {
      body: data.body || "",
      icon: data.icon || "/icon-192.png",
      badge: data.badge || "/icon-192.png",
      tag: data.tag || "bff-notification",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
