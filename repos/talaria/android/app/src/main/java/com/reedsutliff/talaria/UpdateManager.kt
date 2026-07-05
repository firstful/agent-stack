package com.reedsutliff.talaria

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Manages OTA self-updates for Talaria via install.ffilt.us.
 *
 * Checks for a newer APK version, downloads it to cacheDir, and
 * triggers the system package installer via FileProvider content URI.
 *
 * Flow:
 *   GET https://install.ffilt.us/update?app=com.reedsutliff.talaria&ver=<code>
 *   202 → up to date
 *   200 → download APK, then launch installer
 */
object UpdateManager {

    private const val UPDATE_URL = "https://install.ffilt.us/update"
    private const val APP_ID = "com.reedsutliff.talaria"
    private const val NOTIFICATION_CHANNEL = "talaria_updates"
    private const val NOTIFICATION_ID = 901

    /**
     * Check for an update in the background. If a newer version is available,
     * download it and prompt the user to install.
     *
     * @param context Application context
     * @param currentVersionCode The current BuildConfig.VERSION_CODE
     * @param currentVersionName The current BuildConfig.VERSION_NAME (for logging)
     */
    suspend fun check(
        context: Context,
        currentVersionCode: Int,
        currentVersionName: String,
    ) = withContext(Dispatchers.IO) {
        try {
            val url = URL("$UPDATE_URL?app=$APP_ID&ver=$currentVersionCode")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 10_000
            conn.readTimeout = 30_000
            conn.instanceFollowRedirects = false

            when (conn.responseCode) {
                202 -> {
                    LogBuffer.log("I", "UpdateManager", "Up to date ($currentVersionName)")
                }
                200 -> {
                    val contentLength = conn.contentLength
                    LogBuffer.log("I", "UpdateManager",
                        "Update available (v${currentVersionCode} → ${conn.getHeaderField("X-Update-Version") ?: "?"}), downloading ($contentLength bytes)")

                    // Show download notification
                    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    createNotificationChannel(nm)

                    val apkFile = File(context.cacheDir, "talaria-update.apk")
                    conn.inputStream.use { input ->
                        FileOutputStream(apkFile).use { output ->
                            val buf = ByteArray(8192)
                            var total = 0
                            var bytesRead: Int
                            while (input.read(buf).also { bytesRead = it } != -1) {
                                output.write(buf, 0, bytesRead)
                                total += bytesRead
                            }
                        }
                    }
                    LogBuffer.log("I", "UpdateManager",
                        "Downloaded ${apkFile.length()} bytes to ${apkFile.absolutePath}")

                    // Trigger installation
                    withContext(Dispatchers.Main) {
                        installApk(context, apkFile)
                    }
                }
                else -> {
                    LogBuffer.log("W", "UpdateManager",
                        "Unexpected response: ${conn.responseCode} ${conn.responseMessage}")
                }
            }
            conn.disconnect()
        } catch (e: Exception) {
            LogBuffer.log("E", "UpdateManager",
                "Update check failed: ${e.message}")
        }
    }

    private fun installApk(context: Context, apkFile: File) {
        try {
            val uri: Uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                apkFile
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            LogBuffer.log("E", "UpdateManager",
                "Failed to launch installer: ${e.message}")
        }
    }

    private fun createNotificationChannel(nm: NotificationManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL,
                "Talaria Updates",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "APK download progress"
            }
            nm.createNotificationChannel(channel)
        }
    }
}
