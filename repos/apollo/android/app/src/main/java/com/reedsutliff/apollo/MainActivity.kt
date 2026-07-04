package com.reedsutliff.apollo

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.reedsutliff.apollo.ui.ApolloApp
import com.reedsutliff.apollo.ui.ApolloTheme
import com.reedsutliff.apollo.LogBuffer

/**
 * Main entry point for Apollo Android v2.
 *
 * Handles the RECORD_AUDIO permission request and delegates all
 * UI rendering to [ApolloApp] via Jetpack Compose.
 * All state management lives in [com.reedsutliff.apollo.ui.ApolloViewModel].
 */
class MainActivity : ComponentActivity() {
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        Log.i(LOG_TAG, "Microphone permission result: granted=$granted")
        if (!granted) {
            Toast.makeText(this, "Microphone permission required", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.i(LOG_TAG, "=== Apollo starting (${BuildConfig.VERSION_NAME}) ===")
        LogBuffer.log("I", "Apollo", "=== Apollo starting (${BuildConfig.VERSION_NAME}) ===")

        // Request microphone permission if not already granted
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            Log.i(LOG_TAG, "Requesting microphone permission")
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            Log.i(LOG_TAG, "Microphone permission already granted")
            LogBuffer.log("I", "Apollo", "Microphone permission already granted")
        }

        setContent {
            ApolloTheme {
                ApolloApp()
            }
        }
    }

    override fun onDestroy() {
        Log.i(LOG_TAG, "Activity destroyed")
        super.onDestroy()
    }

    companion object {
        private const val LOG_TAG = "Apollo"
    }
}
