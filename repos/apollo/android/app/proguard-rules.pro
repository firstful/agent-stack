# Apollo ProGuard Rules
-keepattributes *Annotation*
-keep class com.reedsutliff.apollo.** { *; }
-dontwarn org.conscrypt.**
-dontwarn okhttp3.**
