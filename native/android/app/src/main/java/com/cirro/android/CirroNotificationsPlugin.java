package com.cirro.android;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;

@CapacitorPlugin(name="CirroNotifications",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class CirroNotificationsPlugin extends Plugin {
 static android.graphics.Bitmap brandIcon(Context context){android.graphics.Bitmap bitmap=android.graphics.Bitmap.createBitmap(128,128,android.graphics.Bitmap.Config.ARGB_8888);android.graphics.drawable.Drawable drawable=androidx.core.content.ContextCompat.getDrawable(context,R.drawable.cirro_notification_logo);if(drawable!=null){drawable.setBounds(0,0,128,128);drawable.draw(new android.graphics.Canvas(bitmap));}return bitmap;}
 static void channels(Context context){if(Build.VERSION.SDK_INT>=26){NotificationManager manager=context.getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel("cirro-activity","File activity",NotificationManager.IMPORTANCE_DEFAULT));manager.createNotificationChannel(new NotificationChannel("cirro-shared","Shared files",NotificationManager.IMPORTANCE_DEFAULT));manager.createNotificationChannel(new NotificationChannel("cirro-transfers","File transfers",NotificationManager.IMPORTANCE_LOW));manager.createNotificationChannel(new NotificationChannel("cirro-updates","Software updates",NotificationManager.IMPORTANCE_LOW));}}
 private boolean granted(){return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();}
 @PluginMethod public void status(PluginCall call){call.resolve(new JSObject().put("granted",granted()));}
 @PluginMethod public void request(PluginCall call){if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED)requestPermissionForAlias("notifications",call,"permissionResult");else status(call);}
 @PermissionCallback private void permissionResult(PluginCall call){status(call);}
 @PluginMethod public void openSettings(PluginCall call){Intent intent=new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getContext().getPackageName());getActivity().startActivity(intent);call.resolve();}
 @PluginMethod public void notify(PluginCall call){try{channels(getContext());if(!granted()){call.resolve();return;}PendingIntent open=PendingIntent.getActivity(getContext(),0,new Intent(getContext(),MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Notification notification=new NotificationCompat.Builder(getContext(),Boolean.TRUE.equals(call.getBoolean("shared",false))?"cirro-shared":"cirro-activity").setSmallIcon(R.drawable.ic_stat_cirro).setColor(android.graphics.Color.rgb(0,122,255)).setLargeIcon(brandIcon(getContext())).setSubText("Cirro · "+(Boolean.TRUE.equals(call.getBoolean("shared",false))?"Shared files":"activity".equals(call.getString("kind"))?"File activity":"transfers".equals(call.getString("kind"))?"Transfers":"Notifications")).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setContentTitle(call.getString("title","Cirro")).setContentText(call.getString("message","")).setStyle(new NotificationCompat.BigTextStyle().bigText(call.getString("message",""))).setAutoCancel(true).setContentIntent(open).setSilent(Boolean.TRUE.equals(call.getBoolean("silent",false))).build();NotificationManagerCompat.from(getContext()).notify(call.getInt("id",1001),notification);call.resolve();}catch(Exception error){call.reject("Android could not show the notification.");}}
 @PluginMethod public void progress(PluginCall call){
  try{
   boolean done=Boolean.TRUE.equals(call.getBoolean("done",false));
   String title=call.getString("title","Cirro transfer"),message=call.getString("message","");
   int progress=call.getInt("progress",0),total=call.getInt("total",0);
   Intent intent=new Intent(getContext(),TransferNotificationService.class).putExtra("title",title).putExtra("message",message).putExtra("progress",progress).putExtra("total",total).putExtra("done",done);
   if(done){
    if(TransferNotificationService.running)getContext().startService(intent);
    else TransferNotificationService.complete(getContext(),title,message);
   }else if(TransferNotificationService.running){
    NotificationManagerCompat.from(getContext()).notify(TransferNotificationService.ID,TransferNotificationService.notification(getContext(),title,message,progress,total));
   }else if(Build.VERSION.SDK_INT>=26)getContext().startForegroundService(intent);
   else getContext().startService(intent);
   call.resolve();
  }catch(Exception error){call.reject("Could not update the Android transfer notification.");}
 }
}