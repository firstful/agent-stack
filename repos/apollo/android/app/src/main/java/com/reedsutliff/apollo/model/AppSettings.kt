package com.reedsutliff.apollo.model

import com.reedsutliff.apollo.BuildConfig

data class AppSettings(
    val serverUrl: String = BuildConfig.APOLLO_WS_URL,
    val cfClientId: String = BuildConfig.CF_ACCESS_CLIENT_ID,
    val cfClientSecret: String = BuildConfig.CF_ACCESS_CLIENT_SECRET,
    val lastThreadId: String? = null,
    val sttEnabled: Boolean = true,
    val ttsEnabled: Boolean = true
)
