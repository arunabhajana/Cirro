package com.cirro.android;

import android.accounts.Account;
import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Collections;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name="AccountVault")
public class AccountVaultPlugin extends Plugin {
    private static final String KEY="cirro-account-profiles-v1";
    private final java.util.concurrent.ExecutorService worker=Executors.newFixedThreadPool(2);
    private synchronized SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(KEY))return ((KeyStore.SecretKeyEntry)store.getEntry(KEY,null)).getSecretKey();
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    private synchronized JSONArray read() throws Exception {
        String data=getContext().getSharedPreferences(KEY,Context.MODE_PRIVATE).getString("profiles",null);
        if(data==null)return new JSONArray();
        JSONObject envelope=new JSONObject(data);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(envelope.getString("iv"),Base64.NO_WRAP)));
        return new JSONArray(new String(cipher.doFinal(Base64.decode(envelope.getString("data"),Base64.NO_WRAP)),StandardCharsets.UTF_8));
    }
    private synchronized void write(JSONArray profiles) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        JSONObject envelope=new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).put("data",Base64.encodeToString(cipher.doFinal(profiles.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));
        if(!getContext().getSharedPreferences(KEY,Context.MODE_PRIVATE).edit().putString("profiles",envelope.toString()).commit())throw new Exception("Could not save accounts.");
    }
    @PluginMethod public void listProfiles(PluginCall call) { try {call.resolve(new JSObject().put("profiles",new JSArray(read().toString())));}catch(Exception error){call.reject("Saved accounts could not be read. Sign in again.");} }
    @PluginMethod public void saveProfile(PluginCall call) {
        try {
            JSObject profile=call.getObject("profile");if(profile==null || !profile.has("id") || !profile.has("email") || !profile.has("name"))throw new Exception();
            JSONObject safe=new JSONObject().put("id",profile.getString("id")).put("email",profile.getString("email")).put("name",profile.getString("name")).put("picture",profile.opt("picture"));
            JSONArray old=read(),next=new JSONArray();for(int i=0;i<old.length();i++)if(!old.getJSONObject(i).getString("id").equals(safe.getString("id")))next.put(old.getJSONObject(i));
            if(next.length()>=3){call.reject("Up to three accounts can be connected on Android.");return;}next.put(safe);write(next);call.resolve();
        }catch(Exception error){call.reject("Could not save this account on the device.");}
    }
    @PluginMethod public void removeProfile(PluginCall call) {try{JSONArray old=read(),next=new JSONArray();for(int i=0;i<old.length();i++)if(!old.getJSONObject(i).getString("id").equals(call.getString("id")))next.put(old.getJSONObject(i));write(next);call.resolve();}catch(Exception error){call.reject("Could not remove this account.");}}
    @PluginMethod public void clearProfiles(PluginCall call) {getContext().getSharedPreferences(KEY,Context.MODE_PRIVATE).edit().clear().apply();call.resolve();}

    @PluginMethod public void authorizeSilently(PluginCall call) {
        try {
            JSONObject profile=null;JSONArray profiles=read();for(int i=0;i<profiles.length();i++)if(profiles.getJSONObject(i).getString("id").equals(call.getString("id")))profile=profiles.getJSONObject(i);
            if(profile==null){call.reject("Connect Drive for this account.","DRIVE_CONSENT_REQUIRED");return;}
            final String expected=profile.getString("id");
            AuthorizationRequest request=AuthorizationRequest.builder().setAccount(new Account(profile.getString("email"),"com.google")).setRequestedScopes(java.util.Arrays.asList(new Scope("openid"),new Scope("email"),new Scope("profile"),new Scope("https://www.googleapis.com/auth/drive"))).build();
            Identity.getAuthorizationClient(getActivity()).authorize(request).addOnSuccessListener(result->{
                if(result.hasResolution() || result.getAccessToken()==null){call.reject("Connect Drive for this account.","DRIVE_CONSENT_REQUIRED");return;}
                worker.execute(()->{
                    HttpURLConnection connection=null;
                    try {
                        connection=(HttpURLConnection)new URL("https://openidconnect.googleapis.com/v1/userinfo").openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(15000);connection.setRequestProperty("Authorization","Bearer "+result.getAccessToken());
                        if(connection.getResponseCode()!=200)throw new Exception();
                        ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;while((count=connection.getInputStream().read(buffer))!=-1){if(bytes.size()+count>65536)throw new Exception();bytes.write(buffer,0,count);}String body=new String(bytes.toByteArray(),StandardCharsets.UTF_8);
                        if(!expected.equals(new JSONObject(body).getString("sub")))throw new Exception();
                        call.resolve(new JSObject().put("token",result.getAccessToken()));
                    }catch(Exception error){call.reject("Drive authorization could not be verified. Connect Drive again.","DRIVE_CONSENT_REQUIRED");}
                    finally{if(connection!=null)connection.disconnect();}
                });
            }).addOnFailureListener(error->call.reject("Connect Drive for this account.","DRIVE_CONSENT_REQUIRED"));
        }catch(Exception error){call.reject("Connect Drive for this account.","DRIVE_CONSENT_REQUIRED");}
    }
}
