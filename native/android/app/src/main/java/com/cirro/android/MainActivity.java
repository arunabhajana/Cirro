package com.cirro.android;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import android.content.Intent;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppAppearancePlugin.class);
        registerPlugin(AccountVaultPlugin.class);
        registerPlugin(OfflineFilesPlugin.class);
        registerPlugin(FileTransfersPlugin.class);
        registerPlugin(CirroNotificationsPlugin.class);
        registerPlugin(AndroidUpdatesPlugin.class);
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        getBridge().getWebView().setVerticalScrollBarEnabled(false);
        getBridge().getWebView().setHorizontalScrollBarEnabled(false);
        // Keep scrolling web content inside the system bars on every WebView version.
        // Native padding also protects dialogs, overscroll and live-page reloads.
        android.view.View decor=getWindow().getDecorView();
        android.view.View content=findViewById(android.R.id.content);
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(decor,(view,insets)->{
            androidx.core.graphics.Insets bars=insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars()|androidx.core.view.WindowInsetsCompat.Type.displayCutout());
            androidx.core.graphics.Insets keyboard=insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime());
            content.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,keyboard.bottom));
            return new androidx.core.view.WindowInsetsCompat.Builder(insets).setInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars()|androidx.core.view.WindowInsetsCompat.Type.displayCutout(),androidx.core.graphics.Insets.NONE).build();
        });
        androidx.core.view.ViewCompat.requestApplyInsets(decor);
        AppAppearancePlugin.applySurface(this, getBridge().getWebView(), AppAppearancePlugin.savedDark(this));
    }

    @Override
    protected void load() {
        // BridgeActivity replaces the activity theme before constructing plugins.
        AppAppearancePlugin.applyTheme(this, AppAppearancePlugin.savedDark(this));
        super.load();
    }
    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle handle = getBridge().getPlugin("SocialLogin");
            if (handle != null && handle.getInstance() instanceof SocialLoginPlugin) {
                ((SocialLoginPlugin) handle.getInstance()).handleGoogleLoginIntent(requestCode, data);
            }
        }
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}
