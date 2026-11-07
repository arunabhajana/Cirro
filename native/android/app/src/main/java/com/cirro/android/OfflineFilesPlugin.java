package com.cirro.android;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name="OfflineFiles")
public class OfflineFilesPlugin extends Plugin {
    static void cancelAll(){for(String key:downloads.keySet()){cancelled.add(key);HttpURLConnection connection=downloads.get(key);if(connection!=null)connection.disconnect();}}
    private static final String STORE="cirro-offline";
    private static final java.util.Set<String> cancelled=java.util.concurrent.ConcurrentHashMap.newKeySet();
    private static final java.util.concurrent.ConcurrentHashMap<String,HttpURLConnection> downloads=new java.util.concurrent.ConcurrentHashMap<>();
    @PluginMethod public void cancelFile(PluginCall call){String key=call.getString("key","");cancelled.add(key);HttpURLConnection connection=downloads.get(key);if(connection!=null)connection.disconnect();call.resolve();}
    private final java.util.concurrent.ExecutorService worker=Executors.newFixedThreadPool(2);
    private android.content.SharedPreferences prefs(){return getContext().getSharedPreferences(STORE,Context.MODE_PRIVATE);}
    private synchronized JSONArray records() throws Exception{return new JSONArray(prefs().getString("files","[]"));}
    private synchronized void saveRecord(JSONObject record) throws Exception {JSONArray old=records(),next=new JSONArray();for(int i=0;i<old.length();i++)if(!old.getJSONObject(i).getString("key").equals(record.getString("key")))next.put(old.getJSONObject(i));next.put(record);if(!prefs().edit().putString("files",next.toString()).commit())throw new IOException();}
    private JSONObject record(String key) throws Exception{JSONArray all=records();for(int i=0;i<all.length();i++)if(all.getJSONObject(i).getString("key").equals(key))return all.getJSONObject(i);throw new IOException("Offline copy not found.");}
    private String hash(String value) throws Exception {byte[] digest=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder result=new StringBuilder();for(byte item:digest)result.append(String.format("%02x",item));return result.substring(0,20);}
    private void deleteOwned(JSONObject record){try{Uri uri=Uri.parse(record.getString("uri"));if("file".equals(uri.getScheme())){File file=new File(uri.getPath());if(file.getCanonicalPath().startsWith(new File(getContext().getFilesDir(),"offline").getCanonicalPath()+File.separator))file.delete();}else{DocumentFile file=DocumentFile.fromSingleUri(getContext(),uri);if(file!=null)file.delete();}}catch(Exception ignored){}}
    private JSObject location(){return new JSObject().put("name",prefs().getString("locationName","App storage")).put("custom",prefs().contains("tree"));}
    @PluginMethod public void getLocation(PluginCall call){call.resolve(location());}
    @PluginMethod public void chooseLocation(PluginCall call){Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);startActivityForResult(call,intent,"picked");}
    @ActivityCallback private void picked(PluginCall call,ActivityResult result){if(call==null)return;if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null || result.getData().getData()==null){call.resolve(location().put("cancelled",true));return;}try{Uri uri=result.getData().getData();int flags=result.getData().getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);getContext().getContentResolver().takePersistableUriPermission(uri,flags);DocumentFile tree=DocumentFile.fromTreeUri(getContext(),uri);if(tree==null || !tree.canWrite())throw new IOException();prefs().edit().putString("tree",uri.toString()).putString("locationName",tree.getName()).apply();call.resolve(location());}catch(Exception error){call.reject("This folder is not writable. Choose another folder.");}}
    @PluginMethod public void useAppStorage(PluginCall call){prefs().edit().remove("tree").remove("locationName").apply();call.resolve(location());}
    @PluginMethod public void listFiles(PluginCall call){try{call.resolve(new JSObject().put("files",new JSArray(records().toString())));}catch(Exception error){call.reject("Offline file index could not be read.");}}
    @PluginMethod public void saveFile(PluginCall call){worker.execute(()->{
        HttpURLConnection connection=null;DocumentFile target=null;File local=null;String downloadKey=call.getString("account","")+":"+call.getString("id","");
        try {
            String account=call.getString("account"),id=call.getString("id"),token=call.getString("token"),name=call.getString("name"),mime=call.getString("mime","application/octet-stream");
            if(account==null || id==null || !id.matches("[a-zA-Z0-9_-]+") || token==null || name==null)throw new IOException("Missing download details.");
            boolean export=Boolean.TRUE.equals(call.getBoolean("exportPdf",false));String key=account+":"+id;
            URL url=new URL("https://www.googleapis.com/drive/v3/files/"+id+(export?"/export?mimeType=application%2Fpdf":"?alt=media&supportsAllDrives=true"));
            connection=(HttpURLConnection)url.openConnection();downloads.put(downloadKey,connection);if(cancelled.contains(downloadKey))throw new IOException("Offline download cancelled.");connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(20000);connection.setReadTimeout(30000);connection.setRequestProperty("Authorization","Bearer "+token);
            String resource=call.getString("resourceKey");if(resource!=null && resource.matches("[a-zA-Z0-9_-]+"))connection.setRequestProperty("X-Goog-Drive-Resource-Keys",id+"/"+resource);
            int status=connection.getResponseCode();if(status!=200){if(status==401){call.reject("Drive permission is required to download this file.","DRIVE_CONSENT_REQUIRED");return;}if(status==403){String detail="";try(InputStream input=connection.getErrorStream()){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] data=new byte[4096];int count;while(input!=null&&(count=input.read(data))!=-1&&bytes.size()<65536)bytes.write(data,0,count);detail=new String(bytes.toByteArray(),StandardCharsets.UTF_8);}if(detail.contains("insufficientPermissions")||detail.contains("ACCESS_TOKEN_SCOPE_INSUFFICIENT")){call.reject("Drive permission is required to download this file.","DRIVE_CONSENT_REQUIRED");return;}throw new IOException(detail.contains("exportSizeLimitExceeded")?"Google limits exported documents to 10 MB. Open this document in Google Drive.":"Google Drive does not allow this download. Check the owner’s permissions or try again later.");}throw new IOException("Google Drive download failed ("+status+").");}
            String safeName=name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_");if(safeName.length()>120)safeName=safeName.substring(0,120);if(export&&!safeName.toLowerCase().endsWith(".pdf"))safeName+=".pdf";
            String filename=hash(key)+"-"+safeName,treeUri=prefs().getString("tree",null);OutputStream output;Uri uri;
            if(treeUri!=null){DocumentFile tree=DocumentFile.fromTreeUri(getContext(),Uri.parse(treeUri));if(tree==null||!tree.canWrite())throw new IOException("Offline folder access was lost. Choose the folder again in Settings.");DocumentFile directory=tree.findFile("Cirro");if(directory==null)directory=tree.createDirectory("Cirro");if(directory==null)throw new IOException();target=directory.createFile(export?"application/pdf":mime,filename);if(target==null)throw new IOException();uri=target.getUri();output=getContext().getContentResolver().openOutputStream(uri,"w");}
            else{File directory=new File(getContext().getFilesDir(),"offline");if(!directory.exists()&&!directory.mkdirs())throw new IOException();local=File.createTempFile(hash(key)+"-",".download",directory);uri=Uri.fromFile(local);output=new FileOutputStream(local);}
            if(output==null)throw new IOException();long size=0,lastProgress=0,totalBytes=Math.max(0,connection.getContentLengthLong());try(InputStream input=connection.getInputStream();OutputStream out=output){byte[] buffer=new byte[64*1024];int count;while((count=input.read(buffer))!=-1){if(cancelled.contains(downloadKey))throw new IOException("Offline download cancelled.");out.write(buffer,0,count);size+=count;if(System.currentTimeMillis()-lastProgress>150){notifyListeners("progress",new JSObject().put("key",key).put("bytes",size).put("total",totalBytes));lastProgress=System.currentTimeMillis();}}}
            long expectedSize=connection.getContentLengthLong();if(expectedSize>=0 && size!=expectedSize)throw new IOException("Download was interrupted. Try saving the file again.");
            JSONObject previous=null;try{previous=record(key);}catch(Exception ignored){}
            JSONObject saved=new JSONObject().put("key",key).put("account",account).put("rawId",id).put("name",name).put("downloadName",safeName).put("mime",export?"application/pdf":mime).put("uri",uri.toString()).put("size",size).put("modified",call.getString("modified","")).put("savedAt",System.currentTimeMillis());
            saveRecord(saved);if(previous!=null)deleteOwned(previous);call.resolve(JSObject.fromJSONObject(saved));target=null;local=null;
        }catch(Exception error){call.reject(error.getMessage()==null?"Download failed. Check available storage and folder access.":error.getMessage());}
        finally{downloads.remove(downloadKey);cancelled.remove(downloadKey);if(connection!=null)connection.disconnect();if(target!=null)target.delete();if(local!=null)local.delete();}
    });}
    @PluginMethod public void removeFile(PluginCall call){try{String key=call.getString("key");JSONObject file=record(key);deleteOwned(file);JSONArray all=records(),next=new JSONArray();for(int i=0;i<all.length();i++)if(!all.getJSONObject(i).getString("key").equals(key))next.put(all.getJSONObject(i));prefs().edit().putString("files",next.toString()).apply();call.resolve();}catch(Exception error){call.reject("Could not remove the offline copy.");}}
    @PluginMethod public void openFile(PluginCall call){try{JSONObject file=record(call.getString("key"));Uri uri=Uri.parse(file.getString("uri"));if("file".equals(uri.getScheme()))uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",new File(uri.getPath()));Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,file.getString("mime")).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);getActivity().startActivity(intent);call.resolve();}catch(Exception error){call.reject("No installed app can open this file, or access to the offline copy was lost.");}}
    @PluginMethod public void previewFile(PluginCall call){worker.execute(()->{File target=null;try{JSONObject file=record(call.getString("key"));if(file.getLong("size")>32L*1024*1024)throw new IOException("Previews support files up to 32 MB.");target=File.createTempFile("cirro-preview-",".bin",getContext().getCacheDir());try(InputStream input=getContext().getContentResolver().openInputStream(Uri.parse(file.getString("uri")));OutputStream output=new FileOutputStream(target)){if(input==null)throw new IOException();byte[] buffer=new byte[32768];long total=0;int count;while((count=input.read(buffer))!=-1){total+=count;if(total>32L*1024*1024)throw new IOException("Previews support files up to 32 MB.");output.write(buffer,0,count);}}call.resolve(new JSObject().put("path",target.toURI().toString()).put("mime",file.getString("mime")));}catch(Exception error){if(target!=null)target.delete();call.reject(error.getMessage()==null?"Offline copy is unavailable. Download it again.":error.getMessage());}});}
    @PluginMethod public void releasePreview(PluginCall call){try{Uri uri=Uri.parse(call.getString("path",""));File file=new File(uri.getPath()==null?"":uri.getPath());if(file.getCanonicalPath().startsWith(getContext().getCacheDir().getCanonicalPath()+File.separator)&&file.getName().startsWith("cirro-preview-"))file.delete();call.resolve();}catch(Exception error){call.reject("Could not release the preview.");}}
}
