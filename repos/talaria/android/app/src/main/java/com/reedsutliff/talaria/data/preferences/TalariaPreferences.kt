package com.reedsutliff.talaria.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.reedsutliff.talaria.BuildConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "talaria_settings")

class TalariaPreferences(private val context: Context) {

    companion object Keys {
        val SERVER_URL = stringPreferencesKey("server_url")
        val CF_CLIENT_ID = stringPreferencesKey("cf_client_id")
        val CF_CLIENT_SECRET = stringPreferencesKey("cf_client_secret")
        val LAST_THREAD_ID = stringPreferencesKey("last_thread_id")
        val STT_ENABLED = booleanPreferencesKey("stt_enabled")
        val TTS_ENABLED = booleanPreferencesKey("tts_enabled")
    }

    // ── Flow-based reads ──────────────────────────────────────

    val serverUrl: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[SERVER_URL] ?: "wss://talaria.ffilt.us/v1/ptt"
    }

    val cfClientId: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[CF_CLIENT_ID] ?: BuildConfig.CF_ACCESS_CLIENT_ID
    }

    val cfClientSecret: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[CF_CLIENT_SECRET] ?: BuildConfig.CF_ACCESS_CLIENT_SECRET
    }

    val lastThreadId: Flow<String?> = context.dataStore.data.map { prefs ->
        prefs[LAST_THREAD_ID]
    }

    val sttEnabled: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[STT_ENABLED] ?: true
    }

    val ttsEnabled: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[TTS_ENABLED] ?: true
    }

    // ── Suspend writes ────────────────────────────────────────

    suspend fun setServerUrl(value: String) {
        context.dataStore.edit { prefs -> prefs[SERVER_URL] = value }
    }

    suspend fun setCfClientId(value: String) {
        context.dataStore.edit { prefs -> prefs[CF_CLIENT_ID] = value }
    }

    suspend fun setCfClientSecret(value: String) {
        context.dataStore.edit { prefs -> prefs[CF_CLIENT_SECRET] = value }
    }

    suspend fun setLastThreadId(value: String?) {
        context.dataStore.edit { prefs ->
            if (value != null) prefs[LAST_THREAD_ID] = value else prefs.remove(LAST_THREAD_ID)
        }
    }

    suspend fun setSttEnabled(value: Boolean) {
        context.dataStore.edit { prefs -> prefs[STT_ENABLED] = value }
    }

    suspend fun setTtsEnabled(value: Boolean) {
        context.dataStore.edit { prefs -> prefs[TTS_ENABLED] = value }
    }
}
