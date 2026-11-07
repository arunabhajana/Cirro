package com.cirro.android;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import androidx.core.app.NotificationCompat;

public class UpdateDownloadService extends Service {
 static final int ID=4002;
 static android.app.Notification notification(Context context,String text,int percent){CirroNotificationsPlugin.channels(context);PendingIntent open=PendingIntent.getActivity(context,4002,new Intent(context,MainActivity.class).putExtra("cirro_updates",true),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);return new NotificationCompat.Builder(context,"cirro-updates").setSmallIcon(R.drawable.ic_stat_cirro).setColor(Color.rgb(0,122,255)).setSubText("Cirro · Software update").setContentTitle("Downloading Cirro update").setContentText(text).setContentIntent(open).setOnlyAlertOnce(true).setOngoing(true).setProgress(100,Math.max(0,percent),percent<0).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build();}
 @Override public int onStartCommand(Intent intent,int flags,int startId){startForeground(ID,notification(this,"Preparing your update…",-1));return START_NOT_STICKY;}
 @Override public void onTimeout(int startId,int fgsType){AndroidUpdatesPlugin.cancelCurrent();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
 @Override public void onTaskRemoved(Intent intent){AndroidUpdatesPlugin.cancelCurrent();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
 @Override public android.os.IBinder onBind(Intent intent){return null;}
}
