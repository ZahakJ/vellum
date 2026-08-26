package dev.vellum.mobile;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The three things the shell needs from Android, and the one thing Android
 * needs from the shell.
 *
 * FROM ANDROID: what share started this activity, permission to leave our own
 * origin, and a way for the capture sheet to close itself.
 *
 * FROM THE SHELL: the address of the instance the owner chose. That address is
 * kept in SharedPreferences rather than in the WebView, because the code that
 * has to consult it — {@link #shouldOverrideLoad} — runs while the WebView is
 * displaying the owner's server, where no Capacitor bridge exists. The served
 * app is not our code and we do not inject anything into it.
 */
@CapacitorPlugin(name = "Vellum")
public class VellumPlugin extends Plugin {

    /**
     * The store @capacitor/preferences writes to, with its own key names and no
     * prefix — so `Preferences.get({ key: "lastServer" })` in the shell and
     * {@link #lastServer} here are reading one value, not two copies of one.
     * Keep in step with `KEY_LAST_SERVER` in src/store.ts.
     */
    private static final String PREFS = "CapacitorStorage";

    private static final String KEY_LAST_SERVER = "lastServer";

    static String lastServer(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return prefs.getString(KEY_LAST_SERVER, null);
    }

    /**
     * THE NAVIGATION GATE.
     *
     * Capacitor asks every plugin this before it decides whether a URL stays in
     * the WebView or is handed to the system browser. Returning FALSE means "do
     * not override" — load it here. Returning null defers to Capacitor, whose
     * default for a foreign host is to open the browser, and that is exactly
     * what should happen to a link out of somebody's notes.
     *
     * The allowed set has one member: the host the owner typed and this app
     * verified. It is deliberately NOT `server.allowNavigation` in
     * capacitor.config.ts, because a static list can only be written as "*" for
     * an app whose server is chosen at run time — which is the same as having no
     * gate at all.
     */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String saved = lastServer(getContext());
        if (saved == null) return null;

        Uri trusted = Uri.parse(saved);
        String trustedHost = trusted.getHost();
        String host = url.getHost();
        if (trustedHost == null || host == null) return null;

        // Host AND scheme: an instance reached over https must not be silently
        // downgraded to http by a link, and a phone on a hostile network is
        // exactly where that matters.
        boolean sameHost = trustedHost.equalsIgnoreCase(host);
        boolean samePort = portOf(url) == portOf(trusted);
        boolean sameScheme = trusted.getScheme() != null && trusted.getScheme().equalsIgnoreCase(url.getScheme());
        return (sameHost && samePort && sameScheme) ? Boolean.FALSE : null;
    }

    private static int portOf(Uri uri) {
        if (uri.getPort() != -1) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    /** An Intent → what the shell is told about it. An Intent that is not a
     *  share answers with an empty object, which is how the connection screen
     *  knows it is the connection screen. */
    private static JSObject shareOf(Intent intent) {
        JSObject result = new JSObject();
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (text != null && !text.isEmpty()) result.put("text", text);
            if (subject != null && !subject.isEmpty()) result.put("subject", subject);
            // A share with neither extra still counts as a share: the sheet says
            // "nothing was shared" rather than silently showing the connection
            // screen over the top of somebody's attempt to save something.
            if (!result.has("text") && !result.has("subject")) result.put("text", "");
        }
        return result;
    }

    /** The share this ACTIVITY was launched with. Read off the activity's own
     *  Intent, so the connection screen in one task cannot see a capture handed
     *  to the sheet in another. */
    @PluginMethod
    public void pendingShare(PluginCall call) {
        call.resolve(shareOf(getActivity().getIntent()));
    }

    /**
     * A share that arrived at an activity already showing the sheet
     * (ShareActivity.onNewIntent). Retained until consumed, because the very
     * first one can land before the page has finished booting and a share this
     * app drops on the floor is the one failure the sheet must never have.
     */
    void announceShare(Intent intent) {
        notifyListeners("share", shareOf(intent), true);
    }

    /** Trust this origin and hand the WebView to it. */
    @PluginMethod
    public void connect(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("A url is required");
            return;
        }

        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_LAST_SERVER, url).apply();

        // The session cookie the instance is about to set has to outlive this
        // process, or every cold start would be a fresh sign-in. The server
        // gives it a seven-day Max-Age; this is the half of the bargain the
        // client owes — accept it, and flush it to disk rather than trusting the
        // WebView's own timing when the app is killed from the task switcher.
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);

        getActivity()
            .runOnUiThread(() -> {
                cookies.flush();
                getBridge().getWebView().loadUrl(url);
            });
        call.resolve();
    }

    /** Dismiss the capture sheet. Only the share activity ever calls it; the
     *  main activity's own exit is the back gesture. */
    @PluginMethod
    public void closeShare(PluginCall call) {
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().finish());
    }
}
