package com.reedsutliff.talaria.data.repository

import com.reedsutliff.talaria.model.AppSettings
import com.reedsutliff.talaria.data.preferences.TalariaPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine

class SettingsRepository(private val preferences: TalariaPreferences) {

    val settings: Flow<AppSettings> = combine(
        preferences.serverUrl,
        preferences.cfClientId,
        preferences.cfClientSecret,
        preferences.lastThreadId,
        preferences.sttEnabled,
        preferences.ttsEnabled,
    ) { args ->
        AppSettings(
            serverUrl = args[0] as String,
            cfClientId = args[1] as String,
            cfClientSecret = args[2] as String,
            lastThreadId = args[3] as String?,
            sttEnabled = args[4] as Boolean,
            ttsEnabled = args[5] as Boolean,
        )
    }

    suspend fun update(settings: AppSettings) {
        preferences.setServerUrl(settings.serverUrl)
        preferences.setCfClientId(settings.cfClientId)
        preferences.setCfClientSecret(settings.cfClientSecret)
        preferences.setLastThreadId(settings.lastThreadId)
        preferences.setSttEnabled(settings.sttEnabled)
        preferences.setTtsEnabled(settings.ttsEnabled)
    }
}
