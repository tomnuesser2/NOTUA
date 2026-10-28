package site.notua.twa;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.browser.customtabs.CustomTabsIntent;

import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

/**
 * Erste Station beim Antippen des Icons. Normalfall: startet sofort LauncherActivity (NOTUA in Chrome).
 * Ist NOTUA beim letzten Mal abgestürzt, zeigt sie stattdessen den Fehler mit Knöpfen zum Kopieren,
 * erneut Versuchen oder Öffnen von notua.site direkt in Chrome.
 */
public class StartActivity extends Activity {
    private static final String URL = "https://notua.site/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        File crash = new File(getFilesDir(), Application.CRASH_FILE);
        // Meldung von einer älteren Version (vor einem Update) nicht mehr anzeigen.
        if (crash.exists() && !readFile(crash).startsWith("NOTUA " + BuildConfig.VERSION_NAME + " ")) crash.delete();
        if (!crash.exists()) {
            super.onCreate(savedInstanceState);
            launchNotua();
            return;
        }
        setTheme(android.R.style.Theme_DeviceDefault_NoActionBar);
        super.onCreate(savedInstanceState);
        showCrash(readFile(crash), crash);
    }

    private void launchNotua() {
        Intent i = new Intent(this, LauncherActivity.class);
        i.setAction(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Intent src = getIntent();
        if (src != null && src.getData() != null) { i.setAction(Intent.ACTION_VIEW); i.setData(src.getData()); }
        startActivity(i);
        overridePendingTransition(0, 0);
        finish();
    }

    private void showCrash(final String text, final File crash) {
        int pad = dp(22);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, dp(56), pad, pad);
        root.setBackgroundColor(Color.parseColor("#13161A"));

        TextView title = new TextView(this);
        title.setText("NOTUA konnte nicht starten");
        title.setTextColor(Color.parseColor("#E5E9F0"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText("Bitte „Fehler kopieren“ antippen und den Text an Tom schicken. Mit „NOTUA trotzdem öffnen“ geht es direkt in Chrome weiter.");
        hint.setTextColor(Color.parseColor("#95A4BB"));
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        hint.setPadding(0, dp(8), 0, dp(14));
        root.addView(hint);

        root.addView(button("Fehler kopieren", true, v -> {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("NOTUA Fehler", text));
            Toast.makeText(this, "Fehler kopiert", Toast.LENGTH_SHORT).show();
        }));
        root.addView(button("NOTUA trotzdem öffnen", false, v -> {
            try { new CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse(URL)); }
            catch (Throwable t) { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(URL))); }
        }));
        root.addView(button("Erneut versuchen", false, v -> { crash.delete(); launchNotua(); }));

        TextView details = new TextView(this);
        details.setText(text);
        details.setTextIsSelectable(true);
        details.setTextColor(Color.parseColor("#C9D1DE"));
        details.setTypeface(android.graphics.Typeface.MONOSPACE);
        details.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        details.setPadding(0, dp(16), 0, 0);
        ScrollView sv = new ScrollView(this);
        sv.addView(details);
        root.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private Button button(String label, boolean primary, android.view.View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setGravity(Gravity.CENTER);
        b.setTextColor(Color.parseColor(primary ? "#13161A" : "#E5E9F0"));
        b.setBackgroundColor(Color.parseColor(primary ? "#9AA8DA" : "#2A313B"));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        lp.topMargin = dp(8);
        b.setLayoutParams(lp);
        b.setOnClickListener(l);
        return b;
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private static String readFile(File f) {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) Math.min(f.length(), 200000)];
            int n = in.read(b);
            return new String(b, 0, Math.max(0, n), StandardCharsets.UTF_8);
        } catch (Throwable t) { return "Fehler konnte nicht gelesen werden: " + t; }
    }
}
