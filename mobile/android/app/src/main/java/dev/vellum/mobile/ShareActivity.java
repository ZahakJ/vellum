package dev.vellum.mobile;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

/**
 * "Share to Vellum", from any app on the phone.
 *
 * ITS OWN ACTIVITY, ITS OWN TASK. The alternative — putting the intent filter on
 * MainActivity — means every capture tears down whatever the owner had open in
 * the instance: their place in a note, an unsaved paragraph, a scroll position
 * forty screens down. A share is a thirty-second errand and it should not cost
 * anyone their session.
 *
 * It loads the same index.html as MainActivity, and the shell asks
 * {@code Vellum.pendingShare()} which of its two screens to be. That question is
 * answered from THIS activity's Intent, which is why there is no second HTML
 * file and no flash of the connection screen on the way to the capture sheet.
 */
public class ShareActivity extends BridgeActivity {

    /**
     * False until {@link #onCreate} has returned.
     *
     * {@code BridgeActivity.load()} calls {@code onNewIntent(getIntent())} on
     * itself while it is still building the bridge, so this method runs once
     * for the launching Intent before there is any page to tell. That share is
     * already answered by the boot path's own {@code pendingShare()}; announcing
     * it a second time would mount the sheet twice.
     */
    private boolean started = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(VellumPlugin.class);
        super.onCreate(savedInstanceState);
        started = true;
    }

    /**
     * A second share arriving while the sheet is already up (launchMode
     * singleTop). The Intent is swapped in first, so anything that asks
     * {@code pendingShare()} from here on gets the NEW share; then the page is
     * told, and re-draws itself around it.
     *
     * WHY AN EVENT AND NOT {@code webView.reload()}. Reloading was the obvious
     * move and it does not work: a new Intent is delivered inside the activity's
     * own pause/resume turn, and a reload asked for anywhere in that window —
     * inline, or posted to the view's queue and run just after onResume — is
     * dropped by Chromium without so much as a navigation event. Only a reload
     * delayed by a visible fraction of a second survives, and "sleep long enough
     * that the platform has settled" is not a mechanism, it is a wish. The share
     * is data this process already holds; handing it to the page directly needs
     * no navigation to survive anything, and costs the owner no white flash.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        setIntent(intent);
        super.onNewIntent(intent);
        if (!started || bridge == null) return;
        PluginHandle handle = bridge.getPlugin("Vellum");
        if (handle == null) return;
        ((VellumPlugin) handle.getInstance()).announceShare(intent);
    }
}
