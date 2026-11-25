package fm.nootropic.app;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.lang.ref.WeakReference;

public class MainActivity extends BridgeActivity {
    private static WeakReference<MainActivity> activeInstance = new WeakReference<>(null);
    private volatile boolean backgroundAudioActive = false;

    public static void dispatchMediaActionFromService(final String action) {
        final MainActivity activity = activeInstance.get();
        if (activity == null) return;
        if ("stop".equals(action) || "pause".equals(action)) {
            activity.backgroundAudioActive = false;
        } else if ("play".equals(action)) {
            activity.backgroundAudioActive = true;
        }
        new Handler(Looper.getMainLooper()).post(() -> {
            if (activity.getBridge() == null || activity.getBridge().getWebView() == null) return;
            final String safeAction = "play".equals(action)
                ? "play"
                : ("pause".equals(action) ? "pause" : "stop");
            final String js = "window.__nootropicNativeMediaAction && window.__nootropicNativeMediaAction('" + safeAction + "');";
            activity.getBridge().getWebView().evaluateJavascript(js, null);
        });
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = new WeakReference<>(this);

        if (getWindow() != null) {
            getWindow().setStatusBarColor(Color.parseColor("#0A0B0C"));
            getWindow().setNavigationBarColor(Color.parseColor("#0A0B0C"));
        }

        if (getBridge() != null && getBridge().getWebView() != null) {
            final WebView webView = getBridge().getWebView();
            webView.setBackgroundColor(Color.parseColor("#0A0B0C"));
            final WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setDomStorageEnabled(true);
            webView.addJavascriptInterface(new NativeAudioBridge(), "NootropicNativeBridge");
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep Chromium WebAudio, AudioWorklet & session timer unthrottled while Foreground Audio Service is active
        if (backgroundAudioActive && getBridge() != null && getBridge().getWebView() != null) {
            final WebView webView = getBridge().getWebView();
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (backgroundAudioActive && getBridge() != null && getBridge().getWebView() != null) {
            final WebView webView = getBridge().getWebView();
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    public void onDestroy() {
        backgroundAudioActive = false;
        try {
            final Intent stopIntent = new Intent(this, NootropicAudioService.class)
                .setAction(NootropicAudioService.ACTION_STOP_SERVICE);
            stopService(stopIntent);
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    public final class NativeAudioBridge {
        @JavascriptInterface
        public String getStoreChannel() {
            return "google_play";
        }

        @JavascriptInterface
        public void onAudioStateChanged(final String state, final String title, final String subtitle) {
            final String normalized = state == null ? "stopped" : state.trim().toLowerCase();
            backgroundAudioActive = "playing".equals(normalized);

            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    if ("stopped".equals(normalized)) {
                        final Intent stopIntent = new Intent(MainActivity.this, NootropicAudioService.class)
                            .setAction(NootropicAudioService.ACTION_STOP_SERVICE);
                        stopService(stopIntent);
                        return;
                    }
                    final Intent svcIntent = new Intent(MainActivity.this, NootropicAudioService.class)
                        .setAction(NootropicAudioService.ACTION_START_OR_UPDATE)
                        .putExtra(NootropicAudioService.EXTRA_STATE, normalized)
                        .putExtra(NootropicAudioService.EXTRA_TITLE, title != null ? title : "nootropic.fm")
                        .putExtra(
                            NootropicAudioService.EXTRA_SUBTITLE,
                            subtitle != null ? subtitle : "Study-Backed Psychoacoustic Audio"
                        );
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && "playing".equals(normalized)) {
                        ContextCompat.startForegroundService(MainActivity.this, svcIntent);
                    } else {
                        startService(svcIntent);
                    }
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void openPlayStoreSubscriptions() {
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    final Intent intent = new Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/account/subscriptions?package=" + getPackageName())
                    );
                    startActivity(intent);
                } catch (Exception ignored) {
                }
            });
        }
    }
}
