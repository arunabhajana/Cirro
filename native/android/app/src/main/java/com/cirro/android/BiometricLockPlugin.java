package com.cirro.android;

import android.content.Context;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BiometricLock")
public class BiometricLockPlugin extends Plugin {
    private static final String PREFS = "cirro-security-v1";
    private static final String ENABLED = "biometric-lock";

    private boolean available() {
        return BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            == BiometricManager.BIOMETRIC_SUCCESS;
    }
    private String unavailableReason() {
        int status = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        if (status == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) return "Set up a fingerprint or face unlock in Android settings first.";
        if (status == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE) return "This device does not support biometric unlock.";
        return "Biometric unlock is temporarily unavailable.";
    }
    private boolean enabled() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ENABLED, false); }

    @PluginMethod public void isAvailable(PluginCall call) {
        boolean available = available();
        JSObject result = new JSObject().put("available", available);
        if (!available) result.put("reason", unavailableReason());
        call.resolve(result);
    }
    @PluginMethod public void getEnabled(PluginCall call) { call.resolve(new JSObject().put("enabled", enabled())); }
    @PluginMethod public void setEnabled(PluginCall call) {
        boolean next = call.getBoolean("enabled", false);
        if (next && !available()) { call.reject(unavailableReason(), "BIOMETRIC_UNAVAILABLE"); return; }
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(ENABLED, next).apply();
        call.resolve(new JSObject().put("enabled", next));
    }
    @PluginMethod public void authenticate(PluginCall call) {
        if (!enabled()) { call.resolve(); return; }
        if (!available()) { call.reject(unavailableReason(), "BIOMETRIC_UNAVAILABLE"); return; }
        getActivity().runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(getActivity(), ContextCompat.getMainExecutor(getContext()), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) { super.onAuthenticationSucceeded(result); call.resolve(); }
                @Override public void onAuthenticationError(int code, CharSequence message) { super.onAuthenticationError(code, message); call.reject("Biometric unlock was cancelled.", "BIOMETRIC_CANCELLED"); }
                @Override public void onAuthenticationFailed() { super.onAuthenticationFailed(); }
            });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder().setTitle("Unlock Cirro").setSubtitle("Use your fingerprint or face unlock to continue.").setNegativeButtonText("Cancel").build();
            prompt.authenticate(info);
        });
    }
}
