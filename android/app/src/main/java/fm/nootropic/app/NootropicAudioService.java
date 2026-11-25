package fm.nootropic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

/**
 * Foreground MediaPlayback Service for nootropic.fm.
 * Keeps 48 kHz WebAudio / AudioWorklet / Endless Stream running smoothly when the
 * listener locks their phone screen during 15–60 minute focus, calm, or wind-down sessions.
 */
public class NootropicAudioService extends Service {
    public static final String CHANNEL_ID = "nootropic_fm_playback";
    public static final int NOTIFICATION_ID = 4016;

    public static final String ACTION_START_OR_UPDATE = "fm.nootropic.app.action.START_OR_UPDATE";
    public static final String ACTION_STOP_SERVICE = "fm.nootropic.app.action.STOP_SERVICE";
    public static final String ACTION_USER_PLAY = "fm.nootropic.app.action.USER_PLAY";
    public static final String ACTION_USER_PAUSE = "fm.nootropic.app.action.USER_PAUSE";
    public static final String ACTION_USER_STOP = "fm.nootropic.app.action.USER_STOP";

    public static final String EXTRA_STATE = "extra_state";
    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_SUBTITLE = "extra_subtitle";

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private String lastTitle = "nootropic.fm";
    private String lastSubtitle = "Study-Backed Psychoacoustic Audio";

    @Override
    public void onCreate() {
        super.onCreate();
        ensureNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            return START_NOT_STICKY;
        }

        final String action = intent.getAction();
        if (ACTION_USER_PLAY.equals(action)) {
            MainActivity.dispatchMediaActionFromService("play");
            acquireLocks();
            promoteForeground("playing", lastTitle, lastSubtitle);
            return START_NOT_STICKY;
        }
        if (ACTION_USER_PAUSE.equals(action)) {
            MainActivity.dispatchMediaActionFromService("pause");
            releaseLocks();
            promoteForeground("paused", lastTitle, "Paused · Tap Resume to continue");
            return START_NOT_STICKY;
        }
        if (ACTION_USER_STOP.equals(action) || ACTION_STOP_SERVICE.equals(action)) {
            if (ACTION_USER_STOP.equals(action)) {
                MainActivity.dispatchMediaActionFromService("stop");
            }
            stopPlaybackService();
            return START_NOT_STICKY;
        }

        if (ACTION_START_OR_UPDATE.equals(action)) {
            final String state = intent.getStringExtra(EXTRA_STATE);
            final String title = intent.getStringExtra(EXTRA_TITLE);
            final String subtitle = intent.getStringExtra(EXTRA_SUBTITLE);
            if (title != null && !title.trim().isEmpty()) {
                lastTitle = title.trim();
            }
            if (subtitle != null && !subtitle.trim().isEmpty()) {
                lastSubtitle = subtitle.trim();
            }
            if ("stopped".equalsIgnoreCase(state)) {
                stopPlaybackService();
                return START_NOT_STICKY;
            }
            final boolean isPlaying = !"paused".equalsIgnoreCase(state);
            if (isPlaying) {
                acquireLocks();
            } else {
                releaseLocks();
            }
            promoteForeground(isPlaying ? "playing" : "paused", lastTitle, lastSubtitle);
        }

        return START_NOT_STICKY;
    }

    private void promoteForeground(String state, String title, String subtitle) {
        final Notification notification = buildNotification("playing".equals(state), title, subtitle);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification(boolean isPlaying, String title, String subtitle) {
        final int immutableFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        final Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        final PendingIntent contentIntent = PendingIntent.getActivity(this, 100, openIntent, immutableFlags);

        final Intent toggleIntent = new Intent(
            this,
            NootropicAudioService.class
        ).setAction(isPlaying ? ACTION_USER_PAUSE : ACTION_USER_PLAY);
        final PendingIntent togglePending = PendingIntent.getService(this, 101, toggleIntent, immutableFlags);

        final Intent stopIntent = new Intent(this, NootropicAudioService.class).setAction(ACTION_USER_STOP);
        final PendingIntent stopPending = PendingIntent.getService(this, 102, stopIntent, immutableFlags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setSubText("nootropic.fm")
            .setContentIntent(contentIntent)
            .setOngoing(isPlaying)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(
                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                isPlaying ? "Pause" : "Resume",
                togglePending
            )
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPending)
            .build();
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            final NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            final NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "nootropic.fm Audio Playback",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Controls for active focus, calm, and wind-down audio sessions");
            channel.setShowBadge(false);
            channel.enableVibration(false);
            channel.setSound(null, null);
            nm.createNotificationChannel(channel);
        }
    }

    private void acquireLocks() {
        try {
            if (wakeLock == null) {
                final PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nootropic:AudioPlaybackLock");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                // 4-hour safety timeout prevents orphaned battery drain
                wakeLock.acquire(4L * 60L * 60L * 1000L);
            }
        } catch (Exception ignored) {
        }

        try {
            if (wifiLock == null) {
                final WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    final int lockMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    wifiLock = wm.createWifiLock(lockMode, "nootropic:AudioStreamWifiLock");
                    wifiLock.setReferenceCounted(false);
                }
            }
            if (wifiLock != null && !wifiLock.isHeld()) {
                wifiLock.acquire();
            }
        } catch (Exception ignored) {
        }
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {
        }
        try {
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
            }
        } catch (Exception ignored) {
        }
    }

    private void stopPlaybackService() {
        releaseLocks();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopPlaybackService();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        releaseLocks();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
