plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.reedsutliff.apollo"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.reedsutliff.apollo"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        // Cloudflare Access service token — set via local.properties or env
        buildConfigField("String", "CF_ACCESS_CLIENT_ID", "\"${project.findProperty("cfAccessClientId") ?: ""}\"")
        buildConfigField("String", "CF_ACCESS_CLIENT_SECRET", "\"${project.findProperty("cfAccessClientSecret") ?: ""}\"")
        buildConfigField("String", "APOLLO_WS_URL", "\"${project.findProperty("apolloWsUrl") ?: "wss://apollo.ffilt.us/v1/ptt"}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.8"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Compose
    val composeBom = platform("androidx.compose:compose-bom:2024.02.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")

    // OkHttp WebSocket
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // ExoPlayer / Media3 for audio playback
    implementation("androidx.media3:media3-exoplayer:1.3.1")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")

    // Debug
    debugImplementation("androidx.compose.ui:ui-tooling")
}
