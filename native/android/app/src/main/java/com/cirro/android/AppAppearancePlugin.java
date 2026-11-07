package com.cirro.android;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.Window;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppAppearance")
public class AppAppearancePlugin extends Plugin {
    static boolean savedDark(Context context) {
        return context.getSharedPreferences("cirro-appearance", Context.MODE_PRIVATE).getBoolean("dark", false);
    }

    static void applyTheme(Activity activity, boolean dark) {
        // SystemBars reads android:windowBackground each time it applies icon style.
        // Override that attribute as well as painting the visible native surface.
        activity.getTheme().applyStyle(dark ? R.style.CirroSurfaceDark : R.style.CirroSurfaceLight, true);
    }

    @SuppressWarnings("deprecation")
    static void applySurface(Activity activity, WebView webView, boolean dark) {
        applyTheme(activity, dark);
        int background = dark ? Color.rgb(16, 16, 18) : Color.WHITE;
        Window window = activity.getWindow();
        window.setBackgroundDrawable(new ColorDrawable(background));
        window.getDecorView().setBackgroundColor(background);
        if (webView != null) webView.setBackgroundColor(background);
        window.setStatusBarColor(background);
        window.setNavigationBarColor(background);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat insets = WindowCompat.getInsetsController(window, window.getDecorView());
        insets.setAppearanceLightStatusBars(!dark);
        insets.setAppearanceLightNavigationBars(!dark);
    }

    @PluginMethod
    public void setTheme(PluginCall call) {
        Boolean dark = call.getBoolean("dark");
        if (dark == null) { call.reject("A dark boolean is required."); return; }
        getActivity().runOnUiThread(() -> {
            getContext().getSharedPreferences("cirro-appearance", Context.MODE_PRIVATE).edit().putBoolean("dark", dark).apply();
            applySurface(getActivity(), getBridge().getWebView(), dark);
            call.resolve();
        });
    }
}
