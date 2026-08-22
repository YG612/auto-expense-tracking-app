# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# sherpa-onnx JNI resolves these wrappers by their binary names.
-keep class com.k2fsa.sherpa.onnx.** { *; }

# EmbeddedSpeechEngineLoader discovers the optional flavor implementation by
# its fully-qualified class name. Keep both optional factory names and their
# public constructors so an R8-minified Internal build cannot silently look
# like an ordinary model-free build.
-keep class com.qingjiai.speech.embedded.streaming.StreamingOnnxSpeechEngineFactory {
    public <init>();
}
-keep class com.qingjiai.speech.embedded.streaming.StreamingZipformerSpeechEngineFactory {
    public <init>();
}

# React Native invokes bridge methods through annotations and generated module
# metadata. Other implementation code remains eligible for optimization.
-keepclasseswithmembers,includedescriptorclasses class * {
    @com.facebook.react.bridge.ReactMethod <methods>;
}
-keep @com.facebook.react.module.annotations.ReactModule class * { *; }
