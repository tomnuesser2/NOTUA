package site.notua.twa;

import android.os.Build;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.Date;

/** Merkt sich einen Absturz (Datei last_crash.txt), damit StartActivity ihn beim nächsten Start anzeigen kann. */
public class Application extends android.app.Application {
    static final String CRASH_FILE = "last_crash.txt";

    @Override
    public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                StringWriter sw = new StringWriter();
                error.printStackTrace(new PrintWriter(sw));
                String info = "NOTUA " + BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ")\n"
                        + "Android " + Build.VERSION.RELEASE + " / API " + Build.VERSION.SDK_INT + "\n"
                        + Build.MANUFACTURER + " " + Build.MODEL + "\n"
                        + "Thread: " + thread.getName() + "\n" + new Date() + "\n\n" + sw;
                try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), CRASH_FILE))) {
                    out.write(info.getBytes(StandardCharsets.UTF_8));
                }
            } catch (Throwable ignored) { }
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }
}
