#include <jni.h>

#include <iomanip>
#include <sstream>
#include <string>

#include "OnDeviceBillClassifierCore.h"

using qingji::classification::OnDeviceBillClassifierCore;

namespace {

std::string fromJavaString(JNIEnv* env, jstring value) {
  const char* chars = env->GetStringUTFChars(value, nullptr);
  if (chars == nullptr) return {};
  std::string result(chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}

}  // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_qingjiai_classification_OnDeviceBillClassifierModule_nativeCreate(
    JNIEnv* env,
    jobject,
    jstring modelDirectory) {
  try {
    auto* classifier =
        new OnDeviceBillClassifierCore(fromJavaString(env, modelDirectory));
    return reinterpret_cast<jlong>(classifier);
  } catch (...) {
    return 0;
  }
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_qingjiai_classification_OnDeviceBillClassifierModule_nativeClassify(
    JNIEnv* env,
    jobject,
    jlong handle,
    jstring text,
    jstring transactionType) {
  auto* classifier = reinterpret_cast<OnDeviceBillClassifierCore*>(handle);
  if (classifier == nullptr) return env->NewStringUTF("");
  try {
    const auto result = classifier->classify(fromJavaString(env, text),
                                             fromJavaString(env, transactionType));
    std::ostringstream output;
    output << result.parentCategoryKey << '\t' << result.subcategoryKey << '\t'
           << std::setprecision(9) << result.top1Probability << '\t'
           << result.top2Probability << '\t' << result.calibratedConfidence
           << '\t' << (result.abstained ? "1" : "0") << '\t' << result.reason
           << '\t' << result.latencyMs;
    return env->NewStringUTF(output.str().c_str());
  } catch (...) {
    return env->NewStringUTF("");
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_qingjiai_classification_OnDeviceBillClassifierModule_nativeDestroy(
    JNIEnv*,
    jobject,
    jlong handle) {
  delete reinterpret_cast<OnDeviceBillClassifierCore*>(handle);
}
