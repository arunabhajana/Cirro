package com.cirro.android;

import android.app.*;
import android.content.*;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

public final class TransferNotificationService extends Service {
 static final int ID=4001;
 static volatile boolean running=false;
 static PendingIntent open(Context context){return PendingIntent.getActivity(context,4001,new Intent(context,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
 static Notification notification(Context context,String title,String text,int progress,int total){
  CirroNotificationsPlugin.channels(context);
  return new NotificationCompat.Builder(context,"cirro-transfers").setSmallIcon(R.drawable.ic_stat_cirro).setColor(android.graphics.Color.rgb(0,122,255)).setLargeIcon(CirroNotificationsPlugin.brandIcon(context)).setSubText("Cirro · Transfers").setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setContentTitle(title).setContentText(text).setStyle(new NotificationCompat.BigTextStyle().bigText(text)).setContentIntent(open(context)).setOnlyAlertOnce(true).setOngoing(true).setProgress(Math.max(1,total),Math.min(Math.max(0,progress),Math.max(1,total)),total<=0).setCategory(NotificationCompat.CATEGORY_PROGRESS).build();
 }
 static void complete(Context context,String title,String text){
  if(!NotificationManagerCompat.from(context).areNotificationsEnabled())return;
  CirroNotificationsPlugin.channels(context);
  NotificationManagerCompat.from(context).notify(ID,new NotificationCompat.Builder(context,"cirro-transfers").setSmallIcon(R.drawable.ic_stat_cirro).setColor(android.graphics.Color.rgb(0,122,255)).setLargeIcon(CirroNotificationsPlugin.brandIcon(context)).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setSubText("Cirro · Transfers").setContentTitle(title).setContentText(text).setStyle(new NotificationCompat.BigTextStyle().bigText(text)).setAutoCancel(true).setContentIntent(open(context)).build());
 }
 @Override public int onStartCommand(Intent intent,int flags,int startId){
  if(intent==null){stopSelf();return START_NOT_STICKY;}
  if(intent.getBooleanExtra("done",false)){
   // Remove the foreground notification before replacing it with the result.
   stopForeground(STOP_FOREGROUND_REMOVE);running=false;
   complete(this,intent.getStringExtra("title"),intent.getStringExtra("message"));stopSelf();return START_NOT_STICKY;
  }
  startForeground(ID,notification(this,intent.getStringExtra("title"),intent.getStringExtra("message"),intent.getIntExtra("progress",0),intent.getIntExtra("total",0)));running=true;return START_NOT_STICKY;
 }
 @Override public void onDestroy(){running=false;super.onDestroy();}
 @Override public void onTimeout(int startId,int fgsType){FileTransfersPlugin.cancelAll();OfflineFilesPlugin.cancelAll();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
 @Override public void onTaskRemoved(Intent intent){FileTransfersPlugin.cancelAll();OfflineFilesPlugin.cancelAll();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
 @Override public android.os.IBinder onBind(Intent intent){return null;}
}
