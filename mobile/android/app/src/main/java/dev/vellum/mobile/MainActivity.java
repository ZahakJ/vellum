package dev.vellum.mobile;

import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebBackForwardList;
import android.webkit.WebHistoryItem;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * The app proper: the connection screen, and then the owner's instance.
 *
 * Capacitor 8 has no opinion about the back gesture — it registers no callback,
 * so the platform default applies and the default is "close the app". In a shell
 * whose whole content is one long-lived web session that is the worst possible
 * behaviour: a reader three notes deep taps back and the app is gone.
 *
 * So back is handled here, in three cases, in this order:
 *
 *   1. On the connection screen → leave. It is the app's front door; there is
 *      nothing behind it.
 *   2. In the instance, with instance history behind us → go back one page.
 *   3. In the instance, at the first page we loaded → return to the connection
 *      screen, telling it NOT to reconnect (`?pick=1`). Without that flag the
 *      screen would auto-connect straight back into the thing the owner just
 *      backed out of, and the back gesture would have no exit at all.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(VellumPlugin.class);
        super.onCreate(savedInstanceState);

        // Persisted, not session, cookies: the instance sets `vellum_session`
        // with a seven-day Max-Age precisely so a phone does not ask for the
        // password every morning.
        CookieManager.getInstance().setAcceptCookie(true);

        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        if (!goBackOnce()) {
                            // Disable and re-dispatch rather than calling
                            // finish(): that lets the platform run whatever it
                            // normally would, predictive-back animation included.
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                        }
                    }
                }
            );
    }

    /** @return true if the gesture was consumed; false to let the app close. */
    private boolean goBackOnce() {
        if (bridge == null) return false;
        WebView webView = bridge.getWebView();
        if (webView == null) return false;

        String local = bridge.getLocalUrl();
        WebBackForwardList history = webView.copyBackForwardList();
        WebHistoryItem current = history.getCurrentItem();
        String currentUrl = current == null ? null : current.getUrl();

        // Case 1 — our own screen, or a WebView with nothing in it yet.
        if (currentUrl == null || currentUrl.startsWith(local)) return false;

        // Case 2 — the instance has somewhere to go back to that is still the
        // instance.
        int index = history.getCurrentIndex();
        if (index > 0) {
            WebHistoryItem previous = history.getItemAtIndex(index - 1);
            if (previous != null && !previous.getUrl().startsWith(local)) {
                webView.goBack();
                return true;
            }
        }

        // Case 3 — the far end of the instance's own history.
        webView.loadUrl(local + "/index.html?pick=1");
        return true;
    }
}
