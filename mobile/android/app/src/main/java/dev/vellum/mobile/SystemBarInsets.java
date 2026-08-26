package dev.vellum.mobile;

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.Bridge;

/**
 * Where the window ends and the app begins.
 *
 * Android 15 (API 35) draws every window edge to edge for any app targeting 35
 * or higher, and Android 16 does it for every app full stop. The status bar and
 * the gesture bar stop being furniture the platform reserves space for and
 * become glass laid over the top and bottom of our own content. Something has to
 * put that space back, and this is it.
 *
 * WHY THIS CLASS EXISTS AT ALL — Capacitor 8 ships an inset handler in its
 * built-in {@code SystemBars} plugin, and it is a good one, but its central
 * decision is
 *
 *   {@code passthrough = webViewMajorVersion >= 140 && pageHasViewportFitCover}
 *
 * and neither half of that conjunction is knowable in this app. Passthrough
 * means "do not pad anything; hand the real insets to the page as
 * {@code env(safe-area-inset-*)} and trust its CSS". Our CSS, on the two
 * bundled screens, does handle them. But this shell spends almost its whole
 * life on a page it did not write and cannot change: the owner's own Vellum
 * instance, on the owner's own origin.
 *
 * And that second flag is not even re-read there. Capacitor learns whether a
 * page said {@code viewport-fit=cover} from its native bridge script, which
 * {@code Bridge.loadWebView()} injects for exactly one origin — the local
 * {@code https://localhost} the connection screen is served from. Navigate to
 * the instance and the flag simply keeps the value the connection screen left
 * behind, which is {@code true}. So on any phone whose WebView is 140 or newer
 * — a 2025 Samsung, say — the instance is handed insets it has no CSS to spend
 * and draws its top row of tabs underneath the notification bar. That is the
 * bug this fixes, and it is invisible on an emulator with an older WebView,
 * where the very same code takes the padding branch and looks perfect.
 *
 * So: {@code insetsHandling: "disable"} in capacitor.config.ts, and the window
 * is ours. Padding, always, on every page, on every WebView version. A shell
 * whose job is to be a window onto somebody else's HTML has no business making
 * that HTML responsible for the notification bar.
 *
 * WHY NOT {@code android:windowOptOutEdgeToEdge}. Because it is a countdown,
 * not a fix: it is documented as temporary, it is already deprecated, and it is
 * ignored outright from API 36. An app that used it would look right for one
 * Android release and then break in exactly this way again, on a phone we would
 * no longer be watching.
 *
 * WHY THE API 35 FLOOR. Below 35 the platform still fits the window to the
 * system bars itself, and it has done so correctly since 2011. Opting a phone
 * running Android 12 into edge-to-edge so we can immediately undo it by hand
 * would trade working platform behaviour for our own, and take the pre-R
 * keyboard with it (see {@code windowSoftInputMode} in AndroidManifest.xml).
 * The floor is where the enforcement is.
 */
final class SystemBarInsets {

    private SystemBarInsets() {}

    /**
     * Called from both activities' {@code onCreate}, after {@code super}, which
     * is where the bridge and therefore the WebView first exist.
     */
    static void apply(final Activity activity, final Bridge bridge) {
        // Android 15. Named rather than 35 so it reads as the release it is.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return;
        if (bridge == null) return;

        WebView webView = bridge.getWebView();
        if (webView == null || !(webView.getParent() instanceof View)) return;

        // The CoordinatorLayout from Capacitor's bridge layout. The padding goes
        // HERE and not on the WebView: a WebView with padding scrolls its own
        // content into that padding, so the top of a note would slide under the
        // status bar the moment anybody scrolled.
        final View container = (View) webView.getParent();

        Window window = activity.getWindow();

        // Say out loud what API 35 already assumes, because the two consequences
        // matter and neither is obvious from the absence of a call. First, the
        // decor stops padding the content view, which is the arrangement this
        // whole class is written for. Second — and this is the keyboard fix —
        // the IME stops resizing the window and starts arriving as an inset
        // instead, so `adjustResize` becomes inert and the listener below is the
        // only thing standing between the owner and a keyboard over their caret.
        WindowCompat.setDecorFitsSystemWindows(window, false);

        // The strips the bars sit on are iron-gall, the same ground as the page,
        // so a letterboxed WebView reads as one dark room rather than as content
        // with two grey bands bolted on. The window background is already this
        // colour (res/values/styles.xml); painting the container too means the
        // strips survive anything that swaps the window background later.
        container.setBackgroundColor(ContextCompat.getColor(activity, R.color.iron_gall));

        ViewCompat.setOnApplyWindowInsetsListener(
            container,
            (v, insets) -> {
                // displayCutout as well as systemBars: on a phone with a
                // punch-hole camera the cutout can be taller than the status
                // bar, and landscape puts it down one side where no system bar
                // is. Taking the union of the two is the only version of this
                // that is right on every phone and every rotation.
                Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                boolean keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());

                // The keyboard's inset is measured from the bottom of the window
                // and so already contains the gesture bar's own strip; adding
                // them would push the editor up by a gesture bar's height of
                // nothing. It replaces the bottom inset, it does not stack with
                // it.
                int bottom = keyboardVisible ? ime.bottom : bars.bottom;

                v.setPadding(bars.left, bars.top, bars.right, bottom);

                // Hand the WebView a window with no system-bar insets left in
                // it. Every pixel it can now paint is a pixel nothing is on top
                // of, so `env(safe-area-inset-*)` inside the page resolves to
                // zero and the CSS second layer in src/styles.css cannot double
                // the padding we just applied.
                //
                // Zeroed rather than WindowInsetsCompat.CONSUMED: returning
                // CONSUMED stops Chromium recalculating its safe-area values at
                // all, which leaves whatever it computed before this listener
                // ran frozen in the page. https://issues.chromium.org/issues/461332423
                return new WindowInsetsCompat.Builder(insets)
                    .setInsets(
                        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout(),
                        Insets.NONE
                    )
                    .build();
            }
        );

        // The listener is attached after the first inset dispatch of the
        // activity's life has already been and gone, so ask for another one.
        // Without this the app is correct only from the first rotation onward.
        ViewCompat.requestApplyInsets(container);
    }
}
