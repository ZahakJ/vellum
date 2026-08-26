import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android shell's configuration.
 *
 * NOTE what is NOT here: `server.allowNavigation`. The one host this app is
 * allowed to leave its own origin for is the host the OWNER TYPED, and that is
 * not knowable at build time. It is enforced at runtime instead, in
 * `VellumPlugin.shouldOverrideLoad` — Capacitor asks every plugin before it
 * decides whether a navigation stays in the WebView or is handed to the
 * browser, and the plugin says yes to exactly one host. A `allowNavigation:
 * ["*"]` here would have been the same feature with the gate taken off.
 */
const config: CapacitorConfig = {
  appId: "dev.vellum.mobile",
  appName: "Vellum",
  webDir: "www",

  server: {
    // https://localhost for the bundled connection screen. The served instance
    // is reached by its own real origin, so its session cookie is scoped to the
    // server the way it would be in any browser.
    androidScheme: "https",
  },

  android: {
    // The shell talks to ONE host and that host may well be a home server with
    // no certificate. Cleartext is permitted by res/xml/network_security_config
    // rather than blanket-allowed here; see that file for the argument.
    allowMixedContent: false,
    // A back gesture that quietly reloaded the page instead of leaving it is
    // the single worst thing a WebView shell does. MainActivity handles back
    // itself; nothing here should second-guess it.
    backgroundColor: "#16130e",
  },

  plugins: {
    SplashScreen: {
      // Hidden by the shell the moment the connection screen has painted, so
      // the gold star never cuts to a blank frame.
      launchAutoHide: false,
      backgroundColor: "#16130e",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      splashFullScreen: false,
      splashImmersive: false,
    },
    SystemBars: {
      // Light glyphs, because every ground this app ever shows is iron-gall.
      style: "DARK",
      insetsHandling: "css",
    },
  },
};

export default config;
