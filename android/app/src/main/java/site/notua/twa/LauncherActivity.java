package site.notua.twa;

import android.content.pm.ActivityInfo;
import android.os.Bundle;

import androidx.browser.customtabs.CustomTabsCallback;

/** Start-Aktivität nach Googles Bubblewrap-Vorlage: öffnet notua.site als Trusted Web Activity in Chrome. */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Eine feste Ausrichtung lässt Android 8.0 und älter mit durchsichtigem Hintergrund abstürzen.
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }

    /**
     * Standardmäßig beendet die Bibliothek die App absichtlich ("QualityEnforcer"), wenn Chrome meldet, dass
     * notua.site die App nicht bestätigt (/.well-known/assetlinks.json ohne passenden Schlüssel), die Seite
     * nicht lädt oder offline ist. Das sah aus wie ein Absturz beim Antippen. Stattdessen öffnet NOTUA dann
     * einfach weiter, notfalls mit kleiner Adressleiste, bis die Bestätigung klappt.
     */
    @Override
    protected CustomTabsCallback getCustomTabsCallback() {
        return new CustomTabsCallback();
    }
}
